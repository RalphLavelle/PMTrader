/**
 * Phase 6 adaptive weighting tests.
 *
 * Conservatism checks: tiny samples stay near baseline; one lucky trade cannot
 * dominate; aggregation uses composite weights — not raw win rate × confidence.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregateSignals } from '../agents/risk-manager/aggregate.js';
import type { AgentSignal } from '../schemas/index.js';
import type { CompletedFitnessTrade } from '../fitness/types.js';
import {
  BASELINE_WEIGHT,
  blendFitness,
  buildAdaptiveWeightTable,
  evidenceLevel,
  scoreTradeSet,
  setAdaptiveTable,
  shrunkWinRate,
} from './index.js';

function trade(
  overrides: Partial<CompletedFitnessTrade> & Pick<CompletedFitnessTrade, 'netPnlUsd' | 'exitAt'>,
): CompletedFitnessTrade {
  return {
    marketId: 'POLY-T',
    owner: 'trend_agent',
    entryAt: '2026-03-01T10:00:00.000Z',
    entryPriceUsd: 0.4,
    exitPriceUsd: 0.5,
    side: 'yes',
    quantity: 25,
    sizeUsd: 10,
    grossPnlUsd: overrides.netPnlUsd,
    estimatedCostUsd: 0,
    holdingMinutes: 60,
    mfeUsd: Math.max(0, overrides.netPnlUsd),
    maeUsd: Math.min(0, overrides.netPnlUsd),
    entryConditions: {
      yesPriceUsd: 0.4,
      noPriceUsd: 0.6,
      liquidityScore: 0.7,
      hoursToClose: 12,
      hadOrderbook: true,
      change5m: null,
      volatility: null,
    },
    exitConditions: {
      yesPriceUsd: 0.5,
      noPriceUsd: 0.5,
      liquidityScore: 0.7,
      hoursToClose: 11,
      hadOrderbook: true,
      change5m: 0.05,
      volatility: 0.02,
    },
    swarmStateAtEntry: {
      recommendation: 'buy_yes',
      confidence: 0.8,
      approved: true,
      signals: [{ agent: 'trend_agent', stance: 'yes', confidence: 0.8 }],
    },
    resolvedTo: null,
    adaptiveWeightsAtEntry: null,
    ...overrides,
  };
}

describe('shrunk win rate', () => {
  it('prevents one lucky trade from pinning win rate at 1.0', () => {
    const trades = [trade({ netPnlUsd: 5, exitAt: '2026-03-01T12:00:00.000Z' })];
    const rate = shrunkWinRate(trades, 1);
    assert.ok(rate !== null);
    assert.ok(rate! < 1);
    assert.ok(rate! > 0.5);
  });
});

describe('adaptive weight conservatism', () => {
  it('pins near baseline when the sample is tiny', () => {
    const tradesByAgent = new Map([
      [
        'trend_agent' as const,
        [
          trade({ netPnlUsd: 20, exitAt: '2026-03-01T12:00:00.000Z' }),
          trade({ netPnlUsd: 15, exitAt: '2026-03-02T12:00:00.000Z' }),
        ],
      ],
    ]);

    const table = buildAdaptiveWeightTable({
      tradesByAgent,
      options: { minSample: 30, inertia: 0, sensitivity: 0.4 },
    });

    const row = table.agents.find((a) => a.agent === 'trend_agent');
    assert.ok(row);
    assert.equal(row!.baselineWeight, BASELINE_WEIGHT);
    assert.equal(row!.evidenceLevel, 'low');
    // With n=2 and minSample=30, reliability ≈ 0.067 — weight barely moves.
    assert.ok(Math.abs(row!.currentWeight - BASELINE_WEIGHT) < 0.1);
  });

  it('raises weight when a large winning sample earns it', () => {
    const winners = Array.from({ length: 40 }, (_, i) =>
      trade({
        marketId: `POLY-${i}`,
        netPnlUsd: 5,
        exitAt: `2026-03-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
      }),
    );

    const table = buildAdaptiveWeightTable({
      tradesByAgent: new Map([['trend_agent', winners]]),
      options: { minSample: 30, inertia: 0, sensitivity: 0.4 },
    });

    const row = table.agents[0]!;
    assert.equal(row.evidenceLevel, 'high');
    assert.ok(row.currentWeight > BASELINE_WEIGHT);
    assert.ok(row.currentWeight <= 1.5);
    assert.ok(row.longTermPnlUsd > 0);
  });

  it('penalises persistent losses and drawdown', () => {
    const losers = Array.from({ length: 40 }, (_, i) =>
      trade({
        marketId: `POLY-L-${i}`,
        netPnlUsd: -5,
        exitAt: `2026-04-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
      }),
    );

    const table = buildAdaptiveWeightTable({
      tradesByAgent: new Map([['mean_reversion_agent', losers]]),
      options: { minSample: 30, inertia: 0, sensitivity: 0.4 },
    });

    const row = table.agents[0]!;
    assert.ok(row.currentWeight < BASELINE_WEIGHT);
    assert.ok(row.drawdownUsd > 0);
    assert.ok(row.longTermPnlUsd < 0);
  });

  it('applies inertia so consecutive passes move gradually', () => {
    const winners = Array.from({ length: 40 }, (_, i) =>
      trade({
        netPnlUsd: 5,
        exitAt: `2026-05-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
      }),
    );

    const first = buildAdaptiveWeightTable({
      tradesByAgent: new Map([['trend_agent', winners]]),
      options: { minSample: 30, inertia: 0, sensitivity: 0.4 },
    });

    const second = buildAdaptiveWeightTable({
      tradesByAgent: new Map([['trend_agent', winners]]),
      previous: {
        ...first,
        agents: first.agents.map((a) => ({ ...a, currentWeight: BASELINE_WEIGHT })),
      },
      options: { minSample: 30, inertia: 0.6, sensitivity: 0.4 },
    });

    const jumped = first.agents[0]!.currentWeight;
    const smoothed = second.agents[0]!.currentWeight;
    // Smoothed should sit between baseline and the full jump.
    assert.ok(smoothed > BASELINE_WEIGHT);
    assert.ok(smoothed < jumped);
  });

  it('exposes evidence levels by sample size', () => {
    assert.equal(evidenceLevel(0, 30), 'none');
    assert.equal(evidenceLevel(5, 30), 'low');
    assert.equal(evidenceLevel(20, 30), 'moderate');
    assert.equal(evidenceLevel(30, 30), 'high');
  });
});

describe('fitness score design', () => {
  it('confidence-adjusts when the agent was overconfident', () => {
    const trades = Array.from({ length: 20 }, (_, i) =>
      trade({
        netPnlUsd: i % 2 === 0 ? 2 : -2,
        exitAt: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
        swarmStateAtEntry: {
          recommendation: 'buy_yes',
          confidence: 0.9,
          approved: true,
          signals: [{ agent: 'trend_agent', stance: 'yes', confidence: 0.95 }],
        },
      }),
    );

    const scored = scoreTradeSet(trades, { winRatePrior: 1 }, 'trend_agent');
    // ~50% wins with 95% stated confidence → confidence-adjusted ≤ raw fitness.
    assert.ok(scored.confidenceAdjusted <= scored.fitness + 1e-9);
  });

  it('blends recent and regime without letting them dominate', () => {
    const blended = blendFitness({
      overall: 0.2,
      recent: 0.8,
      recentCount: 10,
      regimeFitness: -0.5,
      regimeCount: 5,
      minSample: 30,
    });
    // Should stay between the extremes, not snap to recent or regime.
    assert.ok(blended < 0.8);
    assert.ok(blended > -0.5);
  });
});

describe('aggregation uses adaptive weights, not raw win rate', () => {
  const yesTrend: AgentSignal = {
    agent: 'trend_agent',
    stance: 'yes',
    confidence: 0.8,
    reasoning: 'up',
    supportingMetrics: {},
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
  const noMean: AgentSignal = {
    agent: 'mean_reversion_agent',
    stance: 'no',
    confidence: 0.8,
    reasoning: 'fade',
    supportingMetrics: {},
    generatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('boosts the historically stronger specialist without using win rate as the multiplier', () => {
    // Equal raw confidence; unequal adaptive weights.
    const equal = aggregateSignals('m1', [yesTrend, noMean]);
    const tilted = aggregateSignals('m1', [yesTrend, noMean], {
      trend_agent: 1.4,
      mean_reversion_agent: 0.4,
    });

    // With equal confidence, equal weights → near 0.5; tilted → YES-leaning.
    assert.ok(Math.abs(equal.yesLikelihood - 0.5) < 0.05);
    assert.ok(tilted.yesLikelihood > equal.yesLikelihood);
  });

  it('defaults missing agents to baseline influence', () => {
    setAdaptiveTable(null);
    const a = aggregateSignals('m1', [yesTrend], {});
    const b = aggregateSignals('m1', [yesTrend], { trend_agent: BASELINE_WEIGHT });
    assert.equal(a.yesLikelihood, b.yesLikelihood);
    assert.equal(a.recommendation, b.recommendation);
  });
});
