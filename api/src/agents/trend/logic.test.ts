/**
 * Trend Agent tests.
 *
 * The maxim under test is "trends tend to persist": the agent should back a
 * lean only when recent movement agrees with it, stand aside when the trend is
 * reversing, and fall back to lean-only scoring when no history exists.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MarketContext } from '../../features/context.js';
import type { PriceFeatures } from '../../features/types.js';
import type { DerivedFeatures, MarketSnapshot } from '../../schemas/index.js';
import { evaluateTrend } from './logic.js';

const NOW = new Date('2026-01-01T12:00:00.000Z');

/** Minimal but schema-valid snapshot; prices derive from the implied yes probability. */
function makeSnapshot(impliedYes: number): MarketSnapshot {
  return {
    marketId: 'POLY-TEST-TREND',
    title: 'Trend test market',
    status: 'open',
    buyYesPriceUsd: impliedYes,
    buyNoPriceUsd: 1 - impliedYes,
    sellYesPriceUsd: impliedYes,
    sellNoPriceUsd: 1 - impliedYes,
    volumeUsd: 1_000,
    yesDepth: { levels: 3, totalQuantity: 500, bestPriceUsd: impliedYes },
    noDepth: { levels: 3, totalQuantity: 500, bestPriceUsd: 1 - impliedYes },
    rulesPrimary: null,
    rulesSecondary: null,
    closeTime: null,
    capturedAt: NOW.toISOString(),
  };
}

/** Features with extremity derived from the implied probability, like the real builder. */
function makeFeatures(impliedYes: number, overrides: Partial<DerivedFeatures> = {}): DerivedFeatures {
  return {
    impliedYesProbability: impliedYes,
    spreadUsd: 0.01,
    depthImbalance: 0.2,
    totalDepth: 1_000,
    liquidityScore: 0.5,
    priceExtremity: Math.abs(impliedYes - 0.5) / 0.5,
    hoursToClose: 48,
    ...overrides,
  };
}

/** Context whose only interesting part for these tests is the price trajectory. */
function makeContext(snapshot: MarketSnapshot, trajectory: Partial<PriceFeatures>): MarketContext {
  return {
    at: NOW.toISOString(),
    snapshot,
    features: makeFeatures(snapshot.buyYesPriceUsd),
    trajectory: {
      impliedYesProbability: snapshot.buyYesPriceUsd,
      change1m: null,
      change5m: null,
      change10m: null,
      volatility: null,
      volumeDelta: null,
      hoursToClose: 48,
      ...trajectory,
    },
    orderbook: null,
    tradeFlow: {
      tradeCount: 0,
      buyNotionalUsd: 0,
      sellNotionalUsd: 0,
      buySellImbalance: 0,
      averageTradeSizeUsd: 0,
      vwap: null,
    },
    meta: {
      marketId: snapshot.marketId,
      title: snapshot.title,
      status: snapshot.status,
      openTime: null,
      closeTime: null,
      hadOrderbook: false,
      historyPoints: 10,
    },
  };
}

describe('trend agent momentum logic', () => {
  it('falls back to lean-only scoring when no context is provided', () => {
    const snapshot = makeSnapshot(0.72);
    const signal = evaluateTrend(snapshot, makeFeatures(0.72), NOW);

    assert.equal(signal.stance, 'yes');
    // Original formula: 0.5*extremity + 0.3*imbalanceScore + 0.2*liquidity
    // = 0.5*0.44 + 0.3*0.6 + 0.2*0.5 = 0.5
    assert.ok(Math.abs(signal.confidence - 0.5) < 1e-9);
    assert.equal('momentum' in signal.supportingMetrics, false);
  });

  it('falls back to lean-only scoring when the trajectory has no lookback data', () => {
    const snapshot = makeSnapshot(0.72);
    const context = makeContext(snapshot, { change5m: null, change10m: null });
    const signal = evaluateTrend(snapshot, makeFeatures(0.72), NOW, context);

    assert.equal(signal.stance, 'yes');
    assert.ok(Math.abs(signal.confidence - 0.5) < 1e-9);
  });

  it('rewards a favourite that is still climbing', () => {
    const snapshot = makeSnapshot(0.72);
    const context = makeContext(snapshot, {
      change5m: 0.03,
      change10m: 0.05,
      volatility: 0.005,
    });
    const signal = evaluateTrend(snapshot, makeFeatures(0.72), NOW, context);

    assert.equal(signal.stance, 'yes');
    // Rising momentum should beat the 0.5 the lean-only fallback produces.
    assert.ok(signal.confidence > 0.5, `expected > 0.5, got ${signal.confidence}`);
    assert.ok(Math.abs((signal.supportingMetrics.momentum ?? 0) - 0.04) < 1e-9);
    assert.match(signal.reasoning, /gained/);
  });

  it('stands aside when the favourite is falling — the trend is reversing', () => {
    const snapshot = makeSnapshot(0.72);
    const context = makeContext(snapshot, {
      change5m: -0.04,
      change10m: -0.05,
      volatility: 0.005,
    });
    const signal = evaluateTrend(snapshot, makeFeatures(0.72), NOW, context);

    assert.equal(signal.stance, 'neutral');
    assert.equal(signal.confidence, 0);
    assert.match(signal.reasoning, /reversing/);
  });

  it('flips the momentum sign for NO-leaning markets', () => {
    const snapshot = makeSnapshot(0.28);
    const features = makeFeatures(0.28);

    // YES price falling means the NO trend is persisting: back it.
    const persisting = evaluateTrend(
      snapshot,
      features,
      NOW,
      makeContext(snapshot, { change5m: -0.03, change10m: -0.03, volatility: 0.005 }),
    );
    assert.equal(persisting.stance, 'no');
    assert.ok(persisting.confidence > 0.5);

    // YES price rising means the NO trend is breaking: stand aside.
    const breaking = evaluateTrend(
      snapshot,
      features,
      NOW,
      makeContext(snapshot, { change5m: 0.04, change10m: 0.04, volatility: 0.005 }),
    );
    assert.equal(breaking.stance, 'neutral');
    assert.equal(breaking.confidence, 0);
  });

  it('shrinks the momentum contribution when the market is noisy', () => {
    const snapshot = makeSnapshot(0.72);
    const features = makeFeatures(0.72);
    const trajectory = { change5m: 0.03, change10m: 0.05 };

    const steady = evaluateTrend(
      snapshot,
      features,
      NOW,
      makeContext(snapshot, { ...trajectory, volatility: 0.001 }),
    );
    const noisy = evaluateTrend(
      snapshot,
      features,
      NOW,
      makeContext(snapshot, { ...trajectory, volatility: 0.05 }),
    );

    assert.equal(steady.stance, 'yes');
    assert.equal(noisy.stance, 'yes');
    assert.ok(
      noisy.confidence < steady.confidence,
      `noisy ${noisy.confidence} should be below steady ${steady.confidence}`,
    );
  });

  it('stays neutral near even money even when momentum is strong', () => {
    const snapshot = makeSnapshot(0.51);
    const context = makeContext(snapshot, {
      change5m: 0.05,
      change10m: 0.08,
      volatility: 0.005,
    });
    const signal = evaluateTrend(snapshot, makeFeatures(0.51), NOW, context);

    assert.equal(signal.stance, 'neutral');
    assert.equal(signal.confidence, 0);
    assert.match(signal.reasoning, /near even/);
  });
});
