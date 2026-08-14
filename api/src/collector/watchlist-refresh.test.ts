/**
 * Watchlist chooser tests.
 *
 * These pin the learning-oriented rules: quote gate, preferred horizon,
 * diversity cap, and slow soft-eviction. Volume alone must not kick a market.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WATCHLIST_POLICY, selectWatchlist } from './watchlist-refresh.js';
import type { WatchlistSnapshot } from './watchlist-score.js';

const NOW = new Date('2026-08-13T00:00:00.000Z');
const MAX_QUOTE = 1.05;

function closeInHours(hours: number): number {
  return Math.trunc(NOW.getTime() / 1000 + hours * 3600);
}

function snap(partial: Partial<WatchlistSnapshot> & { marketId: string }): WatchlistSnapshot {
  return {
    status: 'open',
    category: 'crypto',
    eventTitle: partial.eventTitle ?? `Event ${partial.marketId}`,
    volumeUsd: 100_000,
    buyYesPriceUsd: 0.4,
    buyNoPriceUsd: 0.61,
    closeTime: closeInHours(48),
    ...partial,
  };
}

function choose(
  docs: WatchlistSnapshot[],
  currentIds: string[],
  extra?: { size?: number; strikes?: Record<string, number> },
) {
  return selectWatchlist({
    currentIds,
    strikes: extra?.strikes ?? {},
    docs,
    size: extra?.size ?? 4,
    categories: ['crypto'],
    now: NOW,
    maxQuoteSum: MAX_QUOTE,
  });
}

describe('selectWatchlist', () => {
  it('drops a market as soon as the sweep sees it leave open', () => {
    const closed = snap({ marketId: 'A', status: 'resolved' });
    const open = snap({ marketId: 'B', volumeUsd: 50_000 });
    const result = choose([closed, open], ['A']);
    assert.deepEqual(result.marketIds, ['B']);
    assert.equal(result.skipWrite, false);
  });

  it('refuses a high-volume filler whose yes+no quote fails the paper gate', () => {
    const loud = snap({
      marketId: 'LOUD',
      volumeUsd: 5_000_000,
      buyYesPriceUsd: 0.7,
      buyNoPriceUsd: 0.5,
    });
    const quiet = snap({ marketId: 'QUIET', volumeUsd: 20_000 });
    const result = choose([loud, quiet], []);
    assert.deepEqual(result.marketIds, ['QUIET']);
  });

  it('ranks a nearer-term market above a louder year-end bucket', () => {
    const yearEnd = snap({
      marketId: 'BTC-YEAREND',
      volumeUsd: 6_000_000,
      closeTime: closeInHours(WATCHLIST_POLICY.longHorizonHours + 24),
    });
    const thisWeek = snap({
      marketId: 'THIS-WEEK',
      volumeUsd: 30_000,
      closeTime: closeInHours(100),
    });
    const result = choose([yearEnd, thisWeek], []);
    assert.equal(result.marketIds[0], 'THIS-WEEK');
  });

  it('skips a third market that shares the same event title', () => {
    const a = snap({ marketId: 'BTC-1', eventTitle: 'What price will Bitcoin hit in 2026?' });
    const b = snap({ marketId: 'BTC-2', eventTitle: 'What price will Bitcoin hit in 2026?' });
    const c = snap({ marketId: 'BTC-3', eventTitle: 'What price will Bitcoin hit in 2026?' });
    const other = snap({ marketId: 'ETH-1', eventTitle: 'What price will Ethereum hit in 2026?' });
    const result = choose([a, b, c, other], []);
    assert.equal(result.marketIds.filter((id) => id.startsWith('BTC-')).length, 2);
    assert.ok(result.marketIds.includes('ETH-1'));
  });

  it('does not evict a sticky market just because volume dipped', () => {
    const quietSticky = snap({ marketId: 'STICKY', volumeUsd: 1_000 });
    const louder = snap({ marketId: 'LOUDER', volumeUsd: 9_000_000 });
    const result = choose([quietSticky, louder], ['STICKY'], { size: 1 });
    assert.deepEqual(result.marketIds, ['STICKY']);
    assert.equal(result.strikes['STICKY'], undefined);
  });

  it('accumulates strikes on an extreme-priced sticky market and evicts at 6', () => {
    const lottery = snap({
      marketId: 'LOTTERY',
      buyYesPriceUsd: 0.01,
      buyNoPriceUsd: 0.99,
      closeTime: closeInHours(48),
    });
    const healthy = snap({ marketId: 'HEALTHY', volumeUsd: 40_000 });
    const fifth = choose([lottery, healthy], ['LOTTERY'], { strikes: { LOTTERY: 5 } });
    assert.ok(!fifth.marketIds.includes('LOTTERY'));
    assert.ok(fifth.marketIds.includes('HEALTHY'));
  });

  it('evicts at most two duds per sweep even when many have reached 6 strikes', () => {
    const duds = ['D1', 'D2', 'D3'].map((id) =>
      snap({
        marketId: id,
        buyYesPriceUsd: 0.01,
        buyNoPriceUsd: 0.99,
      }),
    );
    const healthy = snap({ marketId: 'NEW', volumeUsd: 50_000 });
    const result = choose([...duds, healthy], ['D1', 'D2', 'D3'], {
      size: 3,
      strikes: { D1: 5, D2: 5, D3: 5 },
    });
    const remainingDuds = result.marketIds.filter((id) => id.startsWith('D'));
    assert.equal(remainingDuds.length, 1);
    assert.ok(result.marketIds.includes('NEW'));
  });

  it('keeps two long-horizon deep slots and strikes extras when a short-horizon candidate waits', () => {
    const longA = snap({
      marketId: 'LONG-A',
      volumeUsd: 5_000_000,
      closeTime: closeInHours(WATCHLIST_POLICY.longHorizonHours + 48),
    });
    const longB = snap({
      marketId: 'LONG-B',
      volumeUsd: 4_000_000,
      closeTime: closeInHours(WATCHLIST_POLICY.longHorizonHours + 48),
    });
    const longC = snap({
      marketId: 'LONG-C',
      volumeUsd: 3_000_000,
      closeTime: closeInHours(WATCHLIST_POLICY.longHorizonHours + 48),
    });
    const soon = snap({
      marketId: 'SOON',
      volumeUsd: 25_000,
      closeTime: closeInHours(72),
    });
    const result = choose([longA, longB, longC, soon], ['LONG-A', 'LONG-B', 'LONG-C'], {
      size: 4,
    });
    assert.equal(result.strikes['LONG-C'], 1);
    assert.equal(result.strikes['LONG-A'], undefined);
    assert.equal(result.strikes['LONG-B'], undefined);
    assert.ok(result.marketIds.includes('LONG-A'));
    assert.ok(result.marketIds.includes('LONG-B'));
  });

  it('does not wipe the file when every watched market closed and nothing can replace them', () => {
    const closed = snap({ marketId: 'DEAD', status: 'resolved' });
    const result = choose([closed], ['DEAD']);
    assert.equal(result.skipWrite, true);
  });

  it('drops sticky ids missing from the sweep (vanished catalog) and fills from the open pool', () => {
    // A was on the VIP list but Jupiter stopped listing it — not in docs.
    const filler = snap({ marketId: 'B', volumeUsd: 50_000 });
    const result = choose([filler], ['A']);
    assert.deepEqual(result.marketIds, ['B']);
    assert.equal(result.skipWrite, false);
    assert.equal(result.strikes['A'], undefined);
  });
});
