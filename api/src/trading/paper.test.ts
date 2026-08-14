/**
 * Impossible-fill and paper-position guard tests.
 *
 * Complements context.lookahead.test.ts: even with correct as-of quotes, the
 * paper book must refuse sells without inventory, exits before entry, and
 * fills at unusable prices.
 *
 * Guard tests use a permissive execution profile so inventory rules are
 * isolated from depth/slippage physics (those live in fill-model.test.ts).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyPaperAction,
  emptyPortfolio,
  markPosition,
  paperFillPrice,
  proposePaperAction,
  unrealisedPnlUsd,
} from '../trading/paper.js';
import type { FullQuote, PaperApplyOptions, PaperPosition } from '../trading/paper-types.js';

const QUOTE: FullQuote = {
  buyYesPriceUsd: 0.55,
  buyNoPriceUsd: 0.48,
  sellYesPriceUsd: 0.52,
  sellNoPriceUsd: 0.45,
};

const T1 = new Date('2026-01-01T10:00:00.000Z');
const T0 = new Date('2026-01-01T09:00:00.000Z'); // before entry — illegal exit

/** Isolate inventory guards from depth / slippage defaults. */
const OPEN: PaperApplyOptions = {
  execution: {
    slippageBps: 0,
    feeBps: 0,
    noBookDepthUsd: 10_000,
    minFillFraction: 0,
    excessMode: 'partial_fill',
  },
};

describe('conservative fill model', () => {
  it('buys at ask and sells at bid', () => {
    assert.equal(paperFillPrice('buy_yes', QUOTE), 0.55);
    assert.equal(paperFillPrice('buy_no', QUOTE), 0.48);
    assert.equal(paperFillPrice('sell_yes', QUOTE), 0.52);
    assert.equal(paperFillPrice('sell_no', QUOTE), 0.45);
    assert.equal(paperFillPrice('hold', QUOTE), null);
  });

  it('rejects fills when prices are outside (0, 1)', () => {
    const bad: FullQuote = {
      buyYesPriceUsd: 0,
      buyNoPriceUsd: 1,
      sellYesPriceUsd: -0.1,
      sellNoPriceUsd: 2,
    };
    assert.equal(paperFillPrice('buy_yes', bad), null);
    assert.equal(paperFillPrice('buy_no', bad), null);
    assert.equal(paperFillPrice('sell_yes', bad), null);
    assert.equal(paperFillPrice('sell_no', bad), null);
  });
});

describe('impossible paper actions', () => {
  it('cannot sell a position that does not exist', () => {
    const result = applyPaperAction(emptyPortfolio(), 'sell_yes', QUOTE, T1, 10, OPEN);
    assert.equal(result.appliedAction, 'hold');
    assert.match(result.rejectionReason ?? '', /no open position/i);
    assert.equal(result.portfolio.position, null);
  });

  it('cannot sell the wrong side', () => {
    const opened = applyPaperAction(emptyPortfolio(), 'buy_yes', QUOTE, T1, 10, OPEN);
    assert.equal(opened.appliedAction, 'buy_yes');
    const wrong = applyPaperAction(opened.portfolio, 'sell_no', QUOTE, T1, 10, OPEN);
    assert.equal(wrong.appliedAction, 'hold');
    assert.match(wrong.rejectionReason ?? '', /not no/i);
    assert.ok(wrong.portfolio.position);
  });

  it('cannot buy while already long', () => {
    const opened = applyPaperAction(emptyPortfolio(), 'buy_yes', QUOTE, T1, 10, OPEN);
    const again = applyPaperAction(opened.portfolio, 'buy_no', QUOTE, T1, 10, OPEN);
    assert.equal(again.appliedAction, 'hold');
    assert.match(again.rejectionReason ?? '', /already long/i);
  });

  it('cannot exit before entry', () => {
    const opened = applyPaperAction(emptyPortfolio(), 'buy_yes', QUOTE, T1, 10, OPEN);
    const early = applyPaperAction(opened.portfolio, 'sell_yes', QUOTE, T0, 10, OPEN);
    assert.equal(early.appliedAction, 'hold');
    assert.match(early.rejectionReason ?? '', /before entry/i);
  });

  it('cannot buy at an unavailable price', () => {
    const noAsk: FullQuote = { ...QUOTE, buyYesPriceUsd: 0 };
    const result = applyPaperAction(emptyPortfolio(), 'buy_yes', noAsk, T1, 10, OPEN);
    assert.equal(result.appliedAction, 'hold');
    assert.match(result.rejectionReason ?? '', /No usable fill price/i);
  });
});

describe('paper position lifecycle', () => {
  it('opens, marks MFE/MAE, then realises PnL on sell', () => {
    const opened = applyPaperAction(emptyPortfolio(), 'buy_yes', QUOTE, T1, 10, OPEN);
    assert.equal(opened.appliedAction, 'buy_yes');
    assert.ok(opened.portfolio.position);
    assert.equal(opened.fillPriceUsd, 0.55);

    const richer: FullQuote = {
      ...QUOTE,
      sellYesPriceUsd: 0.6,
    };
    const marked = markPosition(opened.portfolio.position!, richer);
    assert.ok(marked.unrealisedPnlUsd !== null && marked.unrealisedPnlUsd > 0);
    assert.equal(marked.position.mfeUsd, marked.unrealisedPnlUsd);

    const poorer: FullQuote = {
      ...QUOTE,
      sellYesPriceUsd: 0.4,
    };
    const drawnDown = markPosition(marked.position, poorer);
    assert.ok(drawnDown.unrealisedPnlUsd !== null && drawnDown.unrealisedPnlUsd < 0);
    assert.equal(drawnDown.position.maeUsd, drawnDown.unrealisedPnlUsd);
    // MFE still remembers the peak.
    assert.equal(drawnDown.position.mfeUsd, marked.unrealisedPnlUsd);

    const closed = applyPaperAction(
      { position: drawnDown.position, realisedPnlUsd: 0 },
      'sell_yes',
      poorer,
      new Date('2026-01-01T11:00:00.000Z'),
      10,
      OPEN,
    );
    assert.equal(closed.appliedAction, 'sell_yes');
    assert.equal(closed.portfolio.position, null);
    assert.ok(closed.stepRealisedPnlUsd < 0);
    assert.equal(closed.portfolio.realisedPnlUsd, closed.stepRealisedPnlUsd);
  });

  it('maps flip recommendations to sell actions', () => {
    const longYes: PaperPosition = {
      side: 'yes',
      sizeUsd: 10,
      contracts: 10 / 0.55,
      entryAt: T1.toISOString(),
      entryPriceUsd: 0.55,
      mfeUsd: 0,
      maeUsd: 0,
    };

    assert.equal(
      proposePaperAction({
        recommendation: 'buy_no',
        approved: true,
        position: longYes,
      }),
      'sell_yes',
    );

    assert.equal(
      proposePaperAction({
        recommendation: 'buy_yes',
        approved: true,
        position: null,
      }),
      'buy_yes',
    );

    assert.equal(
      proposePaperAction({
        recommendation: 'hold',
        approved: false,
        position: longYes,
      }),
      'hold',
    );
  });

  it('sells on a baked stop even when the swarm still likes the same side', () => {
    const longExpensive: PaperPosition = {
      side: 'yes',
      sizeUsd: 10,
      contracts: 12.5,
      entryAt: T1.toISOString(),
      entryPriceUsd: 0.8,
      mfeUsd: 0,
      maeUsd: -3,
      stopKind: 'percent_loss',
      stopPriceUsd: 0.56,
      stopLossPct: 0.3,
    };
    const blown: FullQuote = {
      buyYesPriceUsd: 0.58,
      buyNoPriceUsd: 0.44,
      sellYesPriceUsd: 0.55,
      sellNoPriceUsd: 0.42,
    };
    assert.equal(
      proposePaperAction({
        recommendation: 'buy_yes',
        approved: true,
        position: longExpensive,
        quote: blown,
        now: T1,
      }),
      'sell_yes',
    );
  });

  it('marks unrealised PnL using the sell bid only', () => {
    const position: PaperPosition = {
      side: 'yes',
      sizeUsd: 11,
      contracts: 20,
      entryAt: T1.toISOString(),
      entryPriceUsd: 0.55,
      mfeUsd: 0,
      maeUsd: 0,
    };
    // buyYes is higher than sellYes — mark must use the bid (0.52), not the ask.
    const pnl = unrealisedPnlUsd(position, QUOTE);
    assert.equal(pnl, Math.round(20 * (0.52 - 0.55) * 100) / 100);
  });

  it('ratchets a trailing floor when the bid runs, then keeps it on a dip', () => {
    const trail: PaperPosition = {
      side: 'yes',
      sizeUsd: 10,
      contracts: 25,
      entryAt: T1.toISOString(),
      entryPriceUsd: 0.4,
      mfeUsd: 0,
      maeUsd: 0,
      stopKind: 'trailing_price',
      stopPriceUsd: 0.32,
      trailDistanceUsd: 0.08,
    };
    const run: FullQuote = { ...QUOTE, sellYesPriceUsd: 0.6 };
    const peaked = markPosition(trail, run);
    assert.equal(peaked.position.stopPriceUsd, 0.52);

    const dip: FullQuote = { ...QUOTE, sellYesPriceUsd: 0.55 };
    const afterDip = markPosition(peaked.position, dip);
    assert.equal(afterDip.position.stopPriceUsd, 0.52);
  });
});
