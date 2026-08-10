/**
 * Depth / slippage / partial-fill tests for the conservative execution model.
 *
 * Purpose: prove backtests cannot invent mid fills or infinite depth.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyPaperAction,
  emptyPortfolio,
  simulateBuyFill,
  simulateSellFill,
} from './index.js';
import type { DepthBook, FullQuote } from './index.js';

const QUOTE: FullQuote = {
  buyYesPriceUsd: 0.55,
  buyNoPriceUsd: 0.48,
  sellYesPriceUsd: 0.52,
  sellNoPriceUsd: 0.45,
};

const T1 = new Date('2026-01-01T10:00:00.000Z');

describe('never fills at mid', () => {
  it('buy YES uses ask (or worse), never the mid between bid and ask', () => {
    const mid = (QUOTE.buyYesPriceUsd + QUOTE.sellYesPriceUsd) / 2;
    const fill = simulateBuyFill({
      action: 'buy_yes',
      quote: QUOTE,
      sizeUsd: 10,
      execution: { slippageBps: 0, noBookDepthUsd: 100, minFillFraction: 0 },
    });
    assert.ok(fill.ok);
    assert.ok(fill.fillPriceUsd !== null);
    assert.ok(fill.fillPriceUsd! >= QUOTE.buyYesPriceUsd);
    assert.ok(fill.fillPriceUsd! > mid);
  });

  it('sell YES uses bid (or worse), never the mid', () => {
    const mid = (QUOTE.buyYesPriceUsd + QUOTE.sellYesPriceUsd) / 2;
    const fill = simulateSellFill({
      action: 'sell_yes',
      quote: QUOTE,
      contractsWanted: 10,
      execution: { slippageBps: 0, noBookDepthUsd: 100, minFillFraction: 0 },
    });
    assert.ok(fill.ok);
    assert.ok(fill.fillPriceUsd !== null);
    assert.ok(fill.fillPriceUsd! <= QUOTE.sellYesPriceUsd);
    assert.ok(fill.fillPriceUsd! < mid);
  });
});

describe('depth constraints', () => {
  it('partially fills a buy when the book is thin', () => {
    // Buying YES walks NO bids as implied asks: ask = 1 − noBid.
    // noBid 0.45 → YES ask 0.55, qty 20 → ~$11 notional.
    const book: DepthBook = {
      yesDollars: [['0.52', 100]],
      noDollars: [['0.45', 20]],
    };

    const fill = simulateBuyFill({
      action: 'buy_yes',
      quote: QUOTE,
      sizeUsd: 50,
      book,
      execution: {
        excessMode: 'partial_fill',
        slippageBps: 0,
        feeBps: 0,
        minFillFraction: 0.1,
      },
    });

    assert.ok(fill.ok);
    assert.ok(fill.usedDepth);
    assert.equal(fill.pricing, 'depth_walk');
    assert.ok(fill.filledSizeUsd < 50);
    assert.ok(fill.rejectedSizeUsd > 0);
  });

  it('rejects the whole buy when excessMode is reject_excess', () => {
    const book: DepthBook = {
      yesDollars: [['0.52', 100]],
      noDollars: [['0.45', 5]],
    };

    const fill = simulateBuyFill({
      action: 'buy_yes',
      quote: QUOTE,
      sizeUsd: 50,
      book,
      execution: {
        excessMode: 'reject_excess',
        slippageBps: 0,
        minFillFraction: 0,
      },
    });

    assert.equal(fill.ok, false);
    assert.match(fill.reason ?? '', /reject_excess/i);
  });

  it('caps size when no book is available (no infinite depth)', () => {
    const fill = simulateBuyFill({
      action: 'buy_yes',
      quote: QUOTE,
      sizeUsd: 100,
      book: null,
      execution: {
        excessMode: 'partial_fill',
        slippageBps: 0,
        noBookDepthUsd: 25,
        minFillFraction: 0,
      },
    });

    assert.ok(fill.ok);
    assert.ok(fill.filledSizeUsd <= 25 + 0.01);
    assert.ok(fill.rejectedSizeUsd >= 75 - 0.01);
  });

  it('walks multiple bid levels for a sell (VWAP ≤ best bid)', () => {
    const book: DepthBook = {
      yesDollars: [
        ['0.52', 5],
        ['0.50', 10],
      ],
      noDollars: [],
    };

    const fill = simulateSellFill({
      action: 'sell_yes',
      quote: QUOTE,
      contractsWanted: 12,
      book,
      execution: { slippageBps: 0, minFillFraction: 0, excessMode: 'partial_fill' },
    });

    assert.ok(fill.ok);
    assert.equal(fill.filledContracts, 12);
    assert.ok(fill.fillPriceUsd !== null);
    // 5@0.52 + 7@0.50 = 6.1 / 12 ≈ 0.5083
    assert.ok(fill.fillPriceUsd! < QUOTE.sellYesPriceUsd);
    assert.ok(fill.fillPriceUsd! > 0.5);
  });
});

describe('slippage and fees worsen net vs gross path', () => {
  it('adverse slippage makes buys more expensive', () => {
    const flat = simulateBuyFill({
      action: 'buy_yes',
      quote: QUOTE,
      sizeUsd: 10,
      execution: { slippageBps: 0, noBookDepthUsd: 100, minFillFraction: 0 },
    });
    const slipped = simulateBuyFill({
      action: 'buy_yes',
      quote: QUOTE,
      sizeUsd: 10,
      execution: { slippageBps: 100, noBookDepthUsd: 100, minFillFraction: 0 },
    });

    assert.ok(flat.fillPriceUsd !== null && slipped.fillPriceUsd !== null);
    assert.ok(slipped.fillPriceUsd! > flat.fillPriceUsd!);
  });

  it('fees reduce realised sell P&L', () => {
    const opened = applyPaperAction(emptyPortfolio(), 'buy_yes', QUOTE, T1, 10, {
      execution: {
        slippageBps: 0,
        feeBps: 0,
        noBookDepthUsd: 10_000,
        minFillFraction: 0,
      },
    });

    const exit: FullQuote = { ...QUOTE, sellYesPriceUsd: 0.6 };
    const noFee = applyPaperAction(opened.portfolio, 'sell_yes', exit, T1, 10, {
      execution: {
        slippageBps: 0,
        feeBps: 0,
        noBookDepthUsd: 10_000,
        minFillFraction: 0,
      },
    });
    const withFee = applyPaperAction(opened.portfolio, 'sell_yes', exit, T1, 10, {
      execution: {
        slippageBps: 0,
        feeBps: 100, // 1% of exit notional
        noBookDepthUsd: 10_000,
        minFillFraction: 0,
      },
    });

    assert.ok(withFee.stepRealisedPnlUsd < noFee.stepRealisedPnlUsd);
    assert.ok(withFee.feeUsd > 0);
  });
});
