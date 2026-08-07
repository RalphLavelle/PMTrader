import { replayResolvedMarkets, resolveOptions as resolveBacktestOptions } from '../backtest/index.js';
import type { BacktestOptions, SkippedMarket } from '../backtest/index.js';
import { config } from '../config.js';
import { analysisMemory } from '../memory/index.js';
import { connectMongo } from '../memory/mongodb.client.js';
import type { AgentName } from '../schemas/index.js';
import { buildHeadToHead } from './disagreement.js';
import { buildStanceCalibration, summariseStances, suggestWeight } from './metrics.js';
import { summariseRegimes } from './regimes.js';
import { stancesFromDecision, stancesFromRun } from './stances.js';
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
 * The flow is linear on purpose: gather graded stances from both evidence
 * sources, then hand them to pure functions. Nothing is written back, because a
 * fitness report is a derived view of the dataset rather than a new fact about
 * it.
 */

/** Keep a caller-supplied count inside sane bounds. */
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
  };
}

/** Stances replayed from collected history, plus the markets that were unusable. */
async function gatherBacktestStances(
  options: BacktestOptions,
): Promise<{ stances: GradedStance[]; skipped: SkippedMarket[] }> {
  const harvest = await replayResolvedMarkets(options);
  return {
    stances: harvest.decisions.flatMap(stancesFromDecision),
    skipped: harvest.skipped,
  };
}

/**
 * Stances the live swarm actually produced, from runs the labeller has scored.
 *
 * A failure here is downgraded to an empty list rather than aborting the whole
 * report. Backtest evidence is the bulk of the sample, and losing the semantic
 * agent's rows is much better than losing everything — the missing source shows
 * up as a zero count in `sources`, so it is visible rather than silent.
 */
async function gatherRunStances(maxRuns: number): Promise<GradedStance[]> {
  try {
    const runs = await analysisMemory.list({ limit: maxRuns });
    return runs.flatMap(stancesFromRun);
  } catch (error) {
    console.error('[fitness] Failed to read stored runs:', error);
    return [];
  }
}

/** What a reader should keep in mind about each source's coverage. */
const SOURCE_NOTES: Record<FitnessSource, string> = {
  backtest:
    'Replayed from collected history. Deterministic and plentiful, but the semantic agent cannot be replayed so it never appears here.',
  live_run:
    'Stances the real swarm produced, scored once their market resolved. The only source that can grade the semantic agent, and much the smaller of the two.',
};

/** How much evidence each source contributed, for the header of the report. */
function summariseSources(stances: GradedStance[]): SourceSummary[] {
  const sources: FitnessSource[] = ['backtest', 'live_run'];

  return sources.map((source) => {
    const mine = stances.filter((stance) => stance.source === source);
    return {
      source,
      stances: mine.length,
      markets: new Set(mine.map((stance) => stance.marketId)).size,
      agents: [...new Set(mine.map((stance) => stance.agent))].sort(),
      note: SOURCE_NOTES[source],
    };
  });
}

/** Everything Phase 5 can say about one specialist. */
function buildAgentFitness(
  agent: AgentName,
  stances: GradedStance[],
  minSampleForWeight: number,
): AgentFitness {
  const overall = summariseStances(stances);
  const sources: FitnessSource[] = ['backtest', 'live_run'];

  return {
    agent,
    overall,
    bySource: sources
      .map((source) => ({
        source,
        stats: summariseStances(stances.filter((stance) => stance.source === source)),
      }))
      .filter((entry) => entry.stats.stances > 0),
    calibration: buildStanceCalibration(stances),
    regimes: summariseRegimes(stances),
    weight: suggestWeight(overall, minSampleForWeight),
  };
}

/**
 * Measure every specialist against markets that have already resolved.
 *
 * Agents are ordered by suggested weight, strongest first, so the specialist
 * Phase 6 would lean on hardest is the first thing a reader sees.
 */
export async function runFitness(
  overrides?: Partial<FitnessOptions> & Partial<BacktestOptions>,
): Promise<FitnessReport> {
  const startedAt = new Date();
  const options = resolveFitnessOptions(overrides);

  await connectMongo();

  const replayed = await gatherBacktestStances(options.backtest);
  const live = options.includeLiveRuns ? await gatherRunStances(options.maxRuns) : [];
  const stances = [...replayed.stances, ...live];

  const agentNames = [...new Set(stances.map((stance) => stance.agent))].sort();
  const agents = agentNames
    .map((agent) =>
      buildAgentFitness(
        agent,
        stances.filter((stance) => stance.agent === agent),
        options.minSampleForWeight,
      ),
    )
    .sort((left, right) => right.weight.weight - left.weight.weight);

  const sources = summariseSources(stances);
  const finishedAt = new Date();

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    options,
    sources,
    gradedStances: stances.length,
    marketsCovered: new Set(stances.map((stance) => stance.marketId)).size,
    agents,
    headToHead: buildHeadToHead(stances),
    skipped: replayed.skipped,
    warnings: buildWarnings(stances, agents, sources, options),
  };
}
