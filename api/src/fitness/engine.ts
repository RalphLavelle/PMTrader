import {
  replayResolvedMarkets,
  resolveOptions as resolveBacktestOptions,
  runPaperReplay,
} from '../backtest/index.js';
import type { BacktestOptions, SkippedMarket } from '../backtest/index.js';
import { config } from '../config.js';
import { analysisMemory } from '../memory/index.js';
import { connectMongo } from '../memory/mongodb.client.js';
import type { AgentName } from '../schemas/index.js';
import { summariseBehaviour } from './behaviour.js';
import { buildHeadToHead } from './disagreement.js';
import { buildStanceCalibration, summariseStances, suggestWeight } from './metrics.js';
import { summariseRegimes } from './regimes.js';
import { stancesFromDecision, stancesFromRun } from './stances.js';
import { collectFitnessTrades } from './trades.js';
import { countDrawdownEvents, summariseTrades } from './trading-metrics.js';
import { buildWarnings } from './warnings.js';
import type {
  AgentFitness,
  FitnessOptions,
  FitnessReport,
  FitnessSource,
  GradedStance,
  SourceSummary,
} from './types.js';

/**
 * Phase 5 fitness engine — the only file here that reads MongoDB.
 *
 * Primary path: paper-replay coherent trades for the swarm and each specialist.
 * Secondary path: stance/Brier forecasting diagnostics from Phase 4 + live runs.
 */

function clampCount(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Merge request overrides over configured defaults, then bound them. */
export function resolveFitnessOptions(
  overrides?: Partial<FitnessOptions> & Partial<BacktestOptions>,
): FitnessOptions {
  return {
    backtest: resolveBacktestOptions(overrides?.backtest ?? overrides),
    includeLiveRuns: overrides?.includeLiveRuns ?? true,
    maxRuns: clampCount(overrides?.maxRuns ?? config.fitnessMaxRuns, 1, 5_000),
    minSampleForWeight: clampCount(
      overrides?.minSampleForWeight ?? config.fitnessMinSampleForWeight,
      1,
      10_000,
    ),
    specialistStakeUsd: clampCount(
      overrides?.specialistStakeUsd ?? config.fitnessSpecialistStakeUsd,
      1,
      10_000,
    ),
  };
}

/** Secondary forecasting stances from the fixed-hold Phase 4 harvest. */
async function gatherBacktestStances(
  options: BacktestOptions,
): Promise<{ stances: GradedStance[]; skipped: SkippedMarket[] }> {
  const harvest = await replayResolvedMarkets(options);
  return {
    stances: harvest.decisions.flatMap(stancesFromDecision),
    skipped: harvest.skipped,
  };
}

async function gatherRunStances(maxRuns: number): Promise<GradedStance[]> {
  try {
    const runs = await analysisMemory.list({ limit: maxRuns });
    return runs.flatMap(stancesFromRun);
  } catch (error) {
    console.error('[fitness] Failed to read stored runs:', error);
    return [];
  }
}

const SOURCE_NOTES: Record<FitnessSource, string> = {
  paper_replay:
    'Primary: coherent buy→sell cycles from the intramarket paper book (swarm + per-specialist unit books).',
  backtest:
    'Secondary forecasting: fixed-hold stance grades from collected history. Deterministic, but the semantic agent cannot be replayed.',
  live_run:
    'Secondary forecasting: stances the real swarm produced, scored when an exit (or resolution) is known. The only forecasting source for the semantic agent.',
};

function summariseSources(
  stances: GradedStance[],
  paperTradeCount: number,
  paperMarkets: number,
  paperAgents: AgentName[],
): SourceSummary[] {
  const sources: SourceSummary[] = [
    {
      source: 'paper_replay',
      stances: paperTradeCount,
      markets: paperMarkets,
      agents: paperAgents,
      note: SOURCE_NOTES.paper_replay,
    },
  ];

  for (const source of ['backtest', 'live_run'] as const) {
    const mine = stances.filter((stance) => stance.source === source);
    sources.push({
      source,
      stances: mine.length,
      markets: new Set(mine.map((stance) => stance.marketId)).size,
      agents: [...new Set(mine.map((stance) => stance.agent))].sort(),
      note: SOURCE_NOTES[source],
    });
  }

  return sources;
}

function buildAgentFitness(
  agent: AgentName,
  stances: GradedStance[],
  trades: import('./types.js').CompletedFitnessTrade[],
  histories: import('../backtest/index.js').PaperMarketHistory[],
  minSampleForWeight: number,
): AgentFitness {
  const forecasting = summariseStances(stances);
  const behaviour = summariseBehaviour(
    histories,
    agent,
    trades,
    countDrawdownEvents(trades),
  );
  const trading = summariseTrades(trades, behaviour);
  const sources: FitnessSource[] = ['backtest', 'live_run', 'paper_replay'];

  return {
    agent,
    trading,
    forecasting,
    overall: forecasting,
    bySource: sources
      .map((source) => ({
        source,
        stats: summariseStances(stances.filter((stance) => stance.source === source)),
      }))
      .filter((entry) => entry.stats.stances > 0),
    calibration: buildStanceCalibration(stances),
    regimes: summariseRegimes(stances, trades),
    weight: suggestWeight(trading, forecasting, minSampleForWeight),
    trades,
  };
}

/**
 * Measure specialists and the swarm from coherent paper trades.
 *
 * Forecasting diagnostics remain attached so we can still tell a good
 * forecaster from a good trader.
 */
export async function runFitness(
  overrides?: Partial<FitnessOptions> & Partial<BacktestOptions>,
): Promise<FitnessReport> {
  const startedAt = new Date();
  const options = resolveFitnessOptions(overrides);

  await connectMongo();

  // Primary: chronological paper books.
  const paper = await runPaperReplay({
    maxMarkets: options.backtest.maxMarkets,
    decisionIntervalMinutes: options.backtest.decisionIntervalMinutes,
    minSnapshots: options.backtest.minSnapshots,
    maxSnapshotsPerMarket: options.backtest.maxSnapshotsPerMarket,
    minConfidence: options.backtest.minConfidence,
    requireOrderbook: options.backtest.requireOrderbook,
  });

  const { swarmTrades, byAgent } = collectFitnessTrades(
    paper.histories,
    options.specialistStakeUsd,
  );

  const swarmBehaviour = summariseBehaviour(
    paper.histories,
    'swarm',
    swarmTrades,
    countDrawdownEvents(swarmTrades),
  );
  const swarm = summariseTrades(swarmTrades, swarmBehaviour);

  // Secondary: forecasting stances (fixed-hold + live runs).
  const replayed = await gatherBacktestStances(options.backtest);
  const live = options.includeLiveRuns ? await gatherRunStances(options.maxRuns) : [];
  const stances = [...replayed.stances, ...live];

  const agentNames = [
    ...new Set([...stances.map((s) => s.agent), ...byAgent.keys()]),
  ].sort();

  const agents = agentNames
    .map((agent) =>
      buildAgentFitness(
        agent,
        stances.filter((stance) => stance.agent === agent),
        byAgent.get(agent) ?? [],
        paper.histories,
        options.minSampleForWeight,
      ),
    )
    .sort((left, right) => right.weight.weight - left.weight.weight);

  const sources = summariseSources(
    stances,
    swarmTrades.length + [...byAgent.values()].reduce((n, t) => n + t.length, 0),
    paper.marketsReplayed,
    agentNames,
  );

  const finishedAt = new Date();
  const skipped: SkippedMarket[] = [
    ...paper.skipped,
    ...replayed.skipped.filter(
      (row) => !paper.skipped.some((p) => p.marketId === row.marketId),
    ),
  ];

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    options,
    sources,
    gradedStances: stances.length,
    completedTrades: swarmTrades.length + agents.reduce((n, a) => n + a.trades.length, 0),
    marketsCovered: new Set([
      ...stances.map((s) => s.marketId),
      ...swarmTrades.map((t) => t.marketId),
      ...paper.histories.map((h) => h.marketId),
    ]).size,
    swarm,
    swarmTrades,
    agents,
    headToHead: buildHeadToHead(stances),
    skipped,
    warnings: buildWarnings(stances, agents, sources, options, swarm),
  };
}
