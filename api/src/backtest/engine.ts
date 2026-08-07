import { configuredRiskLimits } from '../agents/risk-manager/limits.js';
import type { RiskLimits } from '../agents/risk-manager/logic.js';
import { config } from '../config.js';
import {
  listLabelledMarkets,
  loadLabel,
  loadMarketOrderbooks,
  loadMarketSnapshots,
} from '../features/coverage.js';
import { connectMongo } from '../memory/mongodb.client.js';
import { buildDecisionPoints } from './history.js';
import {
  buildCalibration,
  summariseBaseline,
  summariseStrategy,
  summariseVetoes,
} from './metrics.js';
import { REPLAY_AGENTS, replayDecision } from './replay.js';
import { scoreDecision } from './score.js';
import type {
  BacktestOptions,
  BacktestSummary,
  MarketBacktestDetail,
  ScoredDecision,
  SkippedMarket,
} from './types.js';

/**
 * Phase 4 backtest engine — the only file here that touches MongoDB.
 *
 * The flow is deliberately linear: load a resolved market's history, thin it to
 * decision points, replay the agents at each one, grade the result, roll up.
 * Everything except the loading is a pure function from the sibling modules.
 */

/** Keep a caller-supplied count inside sane bounds. */
function clampCount(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Merge request overrides over the configured defaults, then bound them. */
export function resolveOptions(overrides?: Partial<BacktestOptions>): BacktestOptions {
  const minConfidence = overrides?.minConfidence ?? configuredRiskLimits.minConfidence;

  return {
    maxMarkets: clampCount(overrides?.maxMarkets ?? config.backtestMaxMarkets, 1, 500),
    decisionIntervalMinutes: clampCount(
      overrides?.decisionIntervalMinutes ?? config.backtestDecisionIntervalMinutes,
      1,
      1_440,
    ),
    minSnapshots: clampCount(overrides?.minSnapshots ?? config.backtestMinSnapshots, 1, 1_000),
    maxSnapshotsPerMarket: clampCount(
      overrides?.maxSnapshotsPerMarket ?? config.backtestMaxSnapshotsPerMarket,
      1,
      2_000,
    ),
    requireOrderbook: overrides?.requireOrderbook ?? false,
    minConfidence: Number.isFinite(minConfidence)
      ? Math.min(1, Math.max(0, minConfidence))
      : configuredRiskLimits.minConfidence,
  };
}

/**
 * The risk limits a run should use.
 *
 * Everything comes from production configuration except the confidence bar,
 * which the caller may sweep. Keeping the rest fixed means a backtest still
 * describes the system that is actually deployed.
 */
function limitsFor(options: BacktestOptions): RiskLimits {
  return { ...configuredRiskLimits, minConfidence: options.minConfidence };
}

/** Roll a market's graded decisions up into its per-market result. */
function summariseMarket(
  marketId: string,
  title: string,
  result: 'yes' | 'no',
  decisions: ScoredDecision[],
): MarketBacktestDetail {
  const first = decisions[0];
  const last = decisions[decisions.length - 1];

  return {
    result: {
      marketId,
      title,
      result,
      firstDecisionAt: first?.decidedAt ?? '',
      lastDecisionAt: last?.decidedAt ?? '',
      stats: summariseStrategy(decisions),
    },
    decisions,
  };
}

/**
 * Replay one resolved market end to end.
 *
 * Returns null when there is not enough history to say anything useful. A
 * market with two snapshots can produce a decision, but that decision tells you
 * about a single instant rather than about the strategy.
 */
export async function backtestMarket(
  marketId: string,
  title: string,
  result: 'yes' | 'no',
  options: BacktestOptions,
): Promise<MarketBacktestDetail | null> {
  const [snapshots, orderbooks] = await Promise.all([
    loadMarketSnapshots(marketId, options.maxSnapshotsPerMarket),
    loadMarketOrderbooks(marketId, options.maxSnapshotsPerMarket),
  ]);

  if (snapshots.length < options.minSnapshots) {
    return null;
  }

  const limits = limitsFor(options);
  const points = buildDecisionPoints(snapshots, orderbooks, options.decisionIntervalMinutes);
  const decisions: ScoredDecision[] = [];

  for (const point of points) {
    if (options.requireOrderbook && !point.hadOrderbook) {
      continue;
    }
    const replayed = replayDecision(point, limits);
    decisions.push(scoreDecision(replayed, point.snapshot, result, limits));
  }

  if (decisions.length === 0) {
    return null;
  }

  return summariseMarket(marketId, title, result, decisions);
}

/** Drill-down for one market, so a surprising row in the table can be inspected. */
export async function backtestSingleMarket(
  marketId: string,
  overrides?: Partial<BacktestOptions>,
): Promise<MarketBacktestDetail | null> {
  await connectMongo();
  const label = await loadLabel(marketId);

  // Only a decisive label can grade anything: a market that stopped trading
  // without a published winner has no answer key.
  if (!label || (label.result !== 'yes' && label.result !== 'no')) {
    return null;
  }

  return backtestMarket(marketId, label.title, label.result, resolveOptions(overrides));
}

/** Every graded decision the replay produced, plus what it had to leave out. */
export interface ReplayHarvest {
  marketsConsidered: number;
  details: MarketBacktestDetail[];
  decisions: ScoredDecision[];
  skipped: SkippedMarket[];
}

/**
 * Replay every resolved market the labeller has produced.
 *
 * Split out from `runBacktest` because Phase 5 needs the raw graded decisions,
 * not the Phase 4 summary: it grades each specialist's stance rather than the
 * blended recommendation. Sharing this loop means both phases replay history
 * identically — if they diverged, "the blend held" and "trend was right" would
 * stop being statements about the same run.
 *
 * Reads MongoDB only — no Jupiter calls — so this is free to run as often as
 * you like and cannot disturb the collector's rate-limit budget.
 */
export async function replayResolvedMarkets(options: BacktestOptions): Promise<ReplayHarvest> {
  await connectMongo();
  const labelled = await listLabelledMarkets(options.maxMarkets);

  const skipped: SkippedMarket[] = [];
  const details: MarketBacktestDetail[] = [];
  const decisions: ScoredDecision[] = [];

  for (const market of labelled) {
    const detail = await backtestMarket(
      market.marketId,
      market.title,
      market.result,
      options,
    );

    if (!detail) {
      skipped.push({
        marketId: market.marketId,
        reason:
          market.snapshotCount < options.minSnapshots
            ? `Only ${market.snapshotCount} snapshots collected (need ${options.minSnapshots}).`
            : 'No decision points survived the sampling and orderbook filters.',
      });
      continue;
    }

    details.push(detail);
    decisions.push(...detail.decisions);
  }

  return { marketsConsidered: labelled.length, details, decisions, skipped };
}

/** Replay every resolved market, then aggregate into the Phase 4 report. */
export async function runBacktest(
  overrides?: Partial<BacktestOptions>,
): Promise<BacktestSummary> {
  const startedAt = new Date();
  const options = resolveOptions(overrides);

  const harvest = await replayResolvedMarkets(options);
  const allDecisions = harvest.decisions;
  const finishedAt = new Date();

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    options,
    riskLimits: limitsFor(options),
    agents: REPLAY_AGENTS,
    marketsConsidered: harvest.marketsConsidered,
    marketsEvaluated: harvest.details.length,
    skipped: harvest.skipped,
    decisionsWithOrderbook: allDecisions.filter((decision) => decision.hadOrderbook).length,
    strategy: summariseStrategy(allDecisions),
    baseline: summariseBaseline(allDecisions),
    calibration: buildCalibration(allDecisions),
    vetoes: summariseVetoes(allDecisions),
    markets: harvest.details.map((detail) => detail.result),
  };
}
