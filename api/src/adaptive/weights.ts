import type { AgentName } from '../schemas/index.js';
import { config } from '../config.js';
import { bestRegimeSlice } from './regime.js';
import { recentTrades, scoreTradeSet, sortChronological } from './score.js';
import {
  BASELINE_WEIGHT,
  WEIGHT_CEILING,
  WEIGHT_FLOOR,
  type AdaptiveAgentWeight,
  type AdaptiveBuildInput,
  type AdaptiveOptions,
  type AdaptiveWeightTable,
  type AgentWeightMap,
  type EvidenceLevel,
} from './types.js';

/**
 * Turn fitness scores into bounded, shrunk, gradual weights.
 *
 * weight = baseline + reliability × sensitivity × effectiveFitness
 * then EMA toward the previous published weight, then clamp.
 *
 * reliability = min(1, n / minSample) — tiny samples stay near baseline.
 */

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function clampWeight(value: number): number {
  return Math.min(WEIGHT_CEILING, Math.max(WEIGHT_FLOOR, value));
}

export function resolveAdaptiveOptions(
  overrides?: Partial<AdaptiveOptions>,
): AdaptiveOptions {
  return {
    minSample: overrides?.minSample ?? config.fitnessMinSampleForWeight,
    recentWindow: overrides?.recentWindow ?? config.adaptiveRecentWindow,
    sensitivity: overrides?.sensitivity ?? config.adaptiveSensitivity,
    inertia: overrides?.inertia ?? config.adaptiveInertia,
    winRatePrior: overrides?.winRatePrior ?? config.adaptiveWinRatePrior,
  };
}

export function evidenceLevel(sampleCount: number, minSample: number): EvidenceLevel {
  if (sampleCount <= 0) {
    return 'none';
  }
  if (sampleCount < minSample * 0.5) {
    return 'low';
  }
  if (sampleCount < minSample) {
    return 'moderate';
  }
  return 'high';
}

/**
 * Blend long-term, recent, and (optional) regime scores.
 *
 * Recent gets more voice as its own sample grows, but never more than half.
 * Regime gets a voice proportional to its sample vs minSample, capped at 0.35.
 */
export function blendFitness(options: {
  overall: number;
  recent: number;
  recentCount: number;
  regimeFitness: number | null;
  regimeCount: number;
  minSample: number;
}): number {
  const recentShare =
    options.recentCount <= 0
      ? 0
      : Math.min(0.5, options.recentCount / Math.max(options.minSample, 1));

  let blended = (1 - recentShare) * options.overall + recentShare * options.recent;

  if (options.regimeFitness !== null && options.regimeCount > 0) {
    const regimeShare = Math.min(
      0.35,
      options.regimeCount / Math.max(options.minSample, 1),
    );
    blended = (1 - regimeShare) * blended + regimeShare * options.regimeFitness;
  }

  return blended;
}

function buildRationale(agent: AdaptiveAgentWeight, options: AdaptiveOptions): string {
  if (agent.sampleCount === 0) {
    return `No coherent paper trades for ${agent.agent}; weight pinned at baseline ${BASELINE_WEIGHT}.`;
  }

  const parts = [
    `${agent.sampleCount} trades`,
    `overall fitness ${agent.overallFitness >= 0 ? '+' : ''}${agent.overallFitness.toFixed(2)}`,
    `recent (${agent.recentSampleCount}) ${agent.recentFitness >= 0 ? '+' : ''}${agent.recentFitness.toFixed(2)}`,
    `confidence-adj ${agent.confidenceAdjustedFitness >= 0 ? '+' : ''}${agent.confidenceAdjustedFitness.toFixed(2)}`,
    `consistency ${agent.consistency.toFixed(2)}`,
    `drawdown $${agent.drawdownUsd.toFixed(2)}`,
  ];

  if (agent.regime) {
    parts.push(
      `regime ${agent.regime.dimension}/${agent.regime.bucket} n=${agent.regime.sampleCount} fitness ${agent.regime.fitness >= 0 ? '+' : ''}${agent.regime.fitness.toFixed(2)}`,
    );
  }

  if (agent.sampleCount < options.minSample) {
    parts.push(
      `shrunk toward baseline (need ${options.minSample} for full influence)`,
    );
  }

  return parts.join('; ') + '.';
}

/** Build one agent's inspectable weight row. */
export function buildAgentWeight(
  agent: AgentName,
  input: AdaptiveBuildInput,
  options: AdaptiveOptions,
): AdaptiveAgentWeight {
  const trades = sortChronological(input.tradesByAgent.get(agent) ?? []);
  const recent = recentTrades(trades, options.recentWindow);

  const overall = scoreTradeSet(trades, options, agent);
  const recentScore = scoreTradeSet(recent, options, agent);

  const regimeSlice = input.regimeContext
    ? bestRegimeSlice(trades, input.regimeContext, options, agent)
    : null;

  const effective = blendFitness({
    overall: overall.confidenceAdjusted,
    recent: recentScore.confidenceAdjusted,
    recentCount: recent.length,
    regimeFitness: regimeSlice?.fitness ?? null,
    regimeCount: regimeSlice?.sampleCount ?? 0,
    minSample: options.minSample,
  });

  // Reliability grows with sample size — tiny n cannot move weight far.
  const reliability = Math.min(1, trades.length / Math.max(options.minSample, 1));
  const raw = BASELINE_WEIGHT + reliability * options.sensitivity * effective;

  const previous =
    input.previous?.agents.find((row) => row.agent === agent)?.currentWeight ??
    BASELINE_WEIGHT;

  // Gradual adaptation: inertia pulls toward the last published weight.
  const smoothed =
    options.inertia * previous + (1 - options.inertia) * raw;
  const currentWeight = round(clampWeight(smoothed));

  const row: AdaptiveAgentWeight = {
    agent,
    currentWeight,
    baselineWeight: BASELINE_WEIGHT,
    sampleCount: trades.length,
    recentSampleCount: recent.length,
    recentPnlUsd: recentScore.pnlUsd,
    longTermPnlUsd: overall.pnlUsd,
    drawdownUsd: overall.drawdownUsd,
    regime: regimeSlice,
    evidenceLevel: evidenceLevel(trades.length, options.minSample),
    overallFitness: overall.fitness,
    recentFitness: recentScore.fitness,
    confidenceAdjustedFitness: overall.confidenceAdjusted,
    consistency: overall.consistency,
    effectiveFitness: round(effective),
    rationale: '',
  };
  row.rationale = buildRationale(row, options);
  return row;
}

/**
 * Build a full adaptive weight table from specialist trades.
 *
 * Agents with zero trades still appear at baseline so aggregation has an
 * explicit row rather than a silent default.
 */
export function buildAdaptiveWeightTable(
  input: AdaptiveBuildInput,
): AdaptiveWeightTable {
  const options = resolveAdaptiveOptions(input.options);
  const agents = [...input.tradesByAgent.keys()].sort();

  // Include anyone who appeared last time so a temporary drought doesn't drop them.
  if (input.previous) {
    for (const row of input.previous.agents) {
      if (!input.tradesByAgent.has(row.agent)) {
        agents.push(row.agent);
      }
    }
  }

  const uniqueAgents = [...new Set(agents)].sort() as AgentName[];
  const rows = uniqueAgents.map((agent) => buildAgentWeight(agent, input, options));

  const warnings: string[] = [];
  const thin = rows.filter((row) => row.sampleCount < options.minSample);
  if (thin.length === rows.length && rows.length > 0) {
    warnings.push(
      `Every specialist has fewer than ${options.minSample} coherent trades; weights stay near baseline ${BASELINE_WEIGHT}.`,
    );
  }

  return {
    computedAt: new Date().toISOString(),
    options,
    baselineWeight: BASELINE_WEIGHT,
    agents: rows,
    sourceFitnessAt: null,
    warnings,
  };
}

/** Compact map for aggregateSignals. */
export function toWeightMap(table: AdaptiveWeightTable | null | undefined): AgentWeightMap {
  if (!table) {
    return {};
  }
  const map: AgentWeightMap = {};
  for (const row of table.agents) {
    map[row.agent] = row.currentWeight;
  }
  return map;
}
