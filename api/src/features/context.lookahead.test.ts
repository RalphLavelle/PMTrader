/**
 * Look-ahead bias tests.
 *
 * A decision at time T must not see observations from T+1 onward. These cases
 * feed archives that deliberately include "future" rows and assert the
 * as-of helpers / MarketContext builder never let them through.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  MarketSnapshotDoc,
  OrderbookSnapshotDoc,
  TradeDoc,
} from '../collector/types.js';
import {
  asOfOrderbook,
  asOfSnapshot,
  buildMarketContextAt,
  deriveTradeFlowFeatures,
  orderbooksAtOrBefore,
  snapshotsAtOrBefore,
  tradesAtOrBefore,
} from '../features/index.js';

const MARKET_ID = 'POLY-TEST-LOOKAHEAD';

/** Build a minimal price row at a fixed ISO time. */
function snap(
  iso: string,
  prices: { yes: number; volume?: number; status?: string },
): MarketSnapshotDoc {
  return {
    capturedAt: new Date(iso),
    marketId: MARKET_ID,
    title: 'Look-ahead test market',
    status: prices.status ?? 'open',
    result: null,
    buyYesPriceUsd: prices.yes,
    buyNoPriceUsd: Math.max(0.01, 1 - prices.yes),
    sellYesPriceUsd: prices.yes,
    sellNoPriceUsd: Math.max(0.01, 1 - prices.yes),
    volumeUsd: prices.volume ?? 100,
    openTime: 1_700_000_000,
    closeTime: 1_800_000_000,
    contentHash: `${iso}-${prices.yes}`,
  };
}

function book(iso: string, yesBid: string): OrderbookSnapshotDoc {
  return {
    capturedAt: new Date(iso),
    marketId: MARKET_ID,
    yesDollars: [[yesBid, 50]],
    noDollars: [['0.40', 40]],
    contentHash: `${iso}-${yesBid}`,
  };
}

function trade(iso: string, id: string, priceUsd: string): TradeDoc {
  return {
    id,
    timestamp: new Date(iso),
    marketId: MARKET_ID,
    ownerPubkey: 'test',
    action: 'buy',
    side: 'yes',
    amountUsd: '10',
    priceUsd,
  };
}

const T0 = '2026-01-01T10:00:00.000Z';
const T1 = '2026-01-01T10:05:00.000Z';
const T2 = '2026-01-01T10:10:00.000Z'; // decision time T
const T3 = '2026-01-01T10:15:00.000Z'; // future — must never leak

describe('look-ahead guards', () => {
  it('snapshotsAtOrBefore drops rows after T', () => {
    const rows = [snap(T0, { yes: 0.4 }), snap(T2, { yes: 0.5 }), snap(T3, { yes: 0.9 })];
    const kept = snapshotsAtOrBefore(rows, Date.parse(T2));
    assert.equal(kept.length, 2);
    assert.ok(kept.every((row) => row.capturedAt.getTime() <= Date.parse(T2)));
    assert.equal(kept[kept.length - 1]?.buyYesPriceUsd, 0.5);
  });

  it('asOfSnapshot never returns a future price row', () => {
    const rows = [snap(T0, { yes: 0.4 }), snap(T2, { yes: 0.5 }), snap(T3, { yes: 0.9 })];
    const found = asOfSnapshot(rows, Date.parse(T2));
    assert.ok(found);
    assert.equal(found.buyYesPriceUsd, 0.5);
    assert.notEqual(found.buyYesPriceUsd, 0.9);
  });

  it('asOfOrderbook never returns a book captured after T', () => {
    const books = [book(T0, '0.40'), book(T2, '0.50'), book(T3, '0.95')];
    const found = asOfOrderbook(books, Date.parse(T2));
    assert.ok(found);
    assert.equal(found.yesDollars[0]?.[0], '0.50');
    assert.equal(orderbooksAtOrBefore(books, Date.parse(T2)).length, 2);
  });

  it('trade flow window excludes fills after T', () => {
    const trades = [
      trade(T1, '1', '0.45'),
      trade(T2, '2', '0.50'),
      trade(T3, '3', '0.99'), // future fill
    ];
    const atMs = Date.parse(T2);
    assert.equal(tradesAtOrBefore(trades, atMs).length, 2);

    const flow = deriveTradeFlowFeatures(trades, atMs, 10 * 60_000);
    assert.equal(flow.tradeCount, 2);
    // VWAP of 0.45 and 0.50 equal-weight ≈ 0.475 — never dragged toward 0.99.
    assert.ok(flow.vwap !== null && flow.vwap < 0.6);
  });
});

describe('buildMarketContextAt look-ahead', () => {
  it('ignores future prices, books, trades, and never exposes resolution', () => {
    const snapshots = [
      snap(T0, { yes: 0.4, volume: 100 }),
      snap(T1, { yes: 0.45, volume: 110 }),
      snap(T2, { yes: 0.5, volume: 120 }),
      // Future: extreme move + huge volume + a fake "result" that must not leak.
      {
        ...snap(T3, { yes: 0.99, volume: 9_999 }),
        result: 'yes' as const,
      },
    ];
    const orderbooks = [book(T0, '0.40'), book(T2, '0.50'), book(T3, '0.99')];
    const trades = [trade(T1, '1', '0.45'), trade(T3, 'future', '0.99')];

    const context = buildMarketContextAt({
      at: new Date(T2),
      snapshots,
      orderbooks,
      trades,
    });

    // Current state is T2, not the future 0.99 tip.
    assert.equal(context.snapshot.buyYesPriceUsd, 0.5);
    assert.equal(context.snapshot.volumeUsd, 120);
    assert.equal(context.at, T2);

    // Trajectory must be computed without the future spike.
    assert.ok(context.trajectory.impliedYesProbability < 0.7);
    assert.equal(context.meta.historyPoints, 3);

    // Orderbook as-of T2, not T3.
    assert.ok(context.orderbook);
    assert.equal(context.orderbook.bestYesBid, 0.5);

    // Future trade excluded.
    assert.equal(context.tradeFlow.tradeCount, 1);

    // Resolution must never appear on the agent-facing context.
    assert.equal('result' in context, false);
    assert.equal('result' in context.meta, false);
    assert.equal('result' in context.snapshot, false);
  });

  it('live tip at T still cannot see T+1 archive rows', () => {
    const snapshots = [snap(T0, { yes: 0.4 }), snap(T3, { yes: 0.99, volume: 9_999 })];
    const live = {
      marketId: MARKET_ID,
      title: 'Look-ahead test market',
      status: 'open',
      buyYesPriceUsd: 0.55,
      buyNoPriceUsd: 0.45,
      sellYesPriceUsd: 0.55,
      sellNoPriceUsd: 0.45,
      volumeUsd: 130,
      yesDepth: { levels: 1, totalQuantity: 10, bestPriceUsd: 0.55 },
      noDepth: { levels: 1, totalQuantity: 10, bestPriceUsd: 0.45 },
      rulesPrimary: 'Test rules',
      rulesSecondary: null,
      closeTime: 1_800_000_000,
      capturedAt: T2,
    };

    const context = buildMarketContextAt({
      at: new Date(T2),
      snapshots,
      orderbooks: [book(T3, '0.99')],
      trades: [trade(T3, 'future', '0.99')],
      liveSnapshot: live,
      openTime: 1_700_000_000,
    });

    assert.equal(context.snapshot.buyYesPriceUsd, 0.55);
    assert.equal(context.meta.historyPoints, 2); // T0 + live tip
    assert.equal(context.orderbook, null); // only book is after T
    assert.equal(context.tradeFlow.tradeCount, 0);
    // Live rules are allowed (they are known at live T); still no result field.
    assert.equal(context.snapshot.rulesPrimary, 'Test rules');
    assert.equal('result' in context, false);
  });
});
