import { configuredRiskLimits } from '../agents/risk-manager/limits.js';
import type { RiskLimits } from '../agents/risk-manager/logic.js';
import { config } from '../config.js';
import {
  listTradableMarkets,
  loadLabel,
  loadMarketOrderbooks,
  loadMarketSnapshots,
  loadTrades,
} from '../features/coverage.js';
import { enrichMarketLabelFields } from './enrich-markets.js';
import { connectMongo } from '../memory/mongodb.client.js';
import { findExitSnapshot } from '../trading/index.js';
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
 * Phase 4 backtest engine — grades intramarket entry→exit trades.
 *
 * Markets no longer need a resolution label to be evaluated. They need enough
 * open-path snapshots that an exit quote exists after the hold window.
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
  const decisionIntervalMinutes = clampCount(
    overrides?.decisionIntervalMinutes ?? config.backtestDecisionIntervalMinutes,
    1,
    1_440,
  );

  return {
    maxMarkets: clampCount(overrides?.maxMarkets ?? config.backtestMaxMarkets, 1, 500),
    decisionIntervalMinutes,
    exitHoldMinutes: clampCount(
      overrides?.exitHoldMinutes ??
        config.backtestExitHoldMinutes ??
        decisionIntervalMinutes,
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

/** Risk limits for a run — production config, except the sweepable confidence bar. */
function limitsFor(options: BacktestOptions): RiskLimits {
  return { ...configuredRiskLimits, minConfidence: options.minConfidence };
}

/** Roll a market's graded decisions up into its per-market result. */
function summariseMarket(
  marketId: string,
  title: string,
  result: 'yes' | 'no' | null,
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
 * Replay one market end to end with intramarket exits.
 *
 * Returns null when there is not enough history for a meaningful exit.
 */
export async function backtestMarket(
  marketId: string,
  title: string,
  result: 'yes' | 'no' | null,
  options: BacktestOptions,
): Promise<MarketBacktestDetail | null> {
  const [snapshots, orderbooks, trades] = await Promise.all([
    loadMarketSnapshots(marketId, options.maxSnapshotsPerMarket),
    loadMarketOrderbooks(marketId, options.maxSnapshotsPerMarket),
    loadTrades({ marketId, limit: options.maxSnapshotsPerMarket, ascending: true }),
  ]);

  if (snapshots.length < options.minSnapshots) {
    return null;
  }

  const limits = limitsFor(options);
  const points = buildDecisionPoints(
    snapshots,
    orderbooks,
    options.decisionIntervalMinutes,
    trades,
  );
  const decisions: ScoredDecision[] = [];

  for (const point of points) {
    if (options.requireOrderbook && !point.hadOrderbook) {
      continue;
    }

    const entryMs = new Date(point.snapshot.capturedAt).getTime();
    const exitDoc = findExitSnapshot(snapshots, entryMs, {
      kind: 'fixed_hold',
      holdMinutes: options.exitHoldMinutes,
    });

    // Skip entries that cannot yet be exited — grading them as "hold to resolve"
    // would reintroduce the obsolete scoreboard.
    if (!exitDoc && point.snapshot.status === 'open') {
      // Still try if we have any later snapshot; findExitSnapshot already looked.
      // If nothing exists after the hold window, leave this decision out.
    }
    if (!exitDoc) {
      continue;
    }

    const replayed = replayDecision(point, limits);
    const exitSnapshot = {
      ...point.snapshot,
      capturedAt: exitDoc.capturedAt.toISOString(),
      buyYesPriceUsd: exitDoc.buyYesPriceUsd,
      buyNoPriceUsd: exitDoc.buyNoPriceUsd,
      sellYesPriceUsd: exitDoc.sellYesPriceUsd,
      sellNoPriceUsd: exitDoc.sellNoPriceUsd,
      volumeUsd: exitDoc.volumeUsd,
      status: exitDoc.status,
      closeTime: exitDoc.closeTime,
      title: exitDoc.title,
      marketId: exitDoc.marketId,
    };

    decisions.push(
      scoreDecision(replayed, point.snapshot, exitSnapshot, limits, {
        exitHoldMinutes: options.exitHoldMinutes,
        resolvedTo: result,
      }),
    );
  }

  if (decisions.length === 0) {
    return null;
  }

  return summariseMarket(marketId, title, result, decisions);
}

/** Drill-down for one market — resolution label is optional. */
export async function backtestSingleMarket(
  marketId: string,
  overrides?: Partial<BacktestOptions>,
): Promise<MarketBacktestDetail | null> {
  await connectMongo();
  const [label, snapshots] = await Promise.all([
    loadLabel(marketId),
    loadMarketSnapshots(marketId, 5),
  ]);

  if (snapshots.length === 0) {
    return null;
  }

  const title = label?.title ?? snapshots[snapshots.length - 1]?.title ?? marketId;
  const result =
    label?.result === 'yes' || label?.result === 'no' ? label.result : null;

  return backtestMarket(marketId, title, result, resolveOptions(overrides));
}

/** Every graded decision the replay produced, plus what it had to leave out. */
export interface ReplayHarvest {
  marketsConsidered: number;
  details: MarketBacktestDetail[];
  decisions: ScoredDecision[];
  skipped: SkippedMarket[];
}

/**
 * Replay markets with enough open-path history for intramarket exits.
 *
 * Renamed conceptually from "resolved markets" — resolution is no longer required.
 * The export name `replayResolvedMarkets` is kept so Phase 5 call sites compile;
 * it now means "replay tradable markets".
 */
export async function replayResolvedMarkets(options: BacktestOptions): Promise<ReplayHarvest> {
  await connectMongo();
  const tradable = await listTradableMarkets({
    limit: options.maxMarkets,
    minSnapshots: options.minSnapshots,
  });

  const skipped: SkippedMarket[] = [];
  const details: MarketBacktestDetail[] = [];
  const decisions: ScoredDecision[] = [];

  for (const market of tradable) {
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
            : `No decision points had an exit quote after a ${options.exitHoldMinutes}-minute hold.`,
      });
      continue;
    }

    details.push(detail);
    decisions.push(...detail.decisions);
  }

  return { marketsConsidered: tradable.length, details, decisions, skipped };
}

/** Replay tradable markets, then aggregate into the Phase 4 report. */
export async function runBacktest(
  overrides?: Partial<BacktestOptions>,
): Promise<BacktestSummary> {
  const startedAt = new Date();
  const options = resolveOptions(overrides);

  const harvest = await replayResolvedMarkets(options);
  const allDecisions = harvest.decisions;
  const finishedAt = new Date();

  // Calibration needs a resolution answer key — only include those decisions.
  const calibratable = allDecisions
    .filter((d) => d.resolvedTo === 'yes' || d.resolvedTo === 'no')
    .map((d) => ({
      yesLikelihood: d.yesLikelihood,
      resolvedTo: d.resolvedTo as 'yes' | 'no',
    }));

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
    decisionsWithExit: allDecisions.filter((d) => d.scoringMode === 'intramarket').length,
    strategy: summariseStrategy(allDecisions),
    baseline: summariseBaseline(allDecisions),
    calibration: buildCalibration(calibratable),
    vetoes: summariseVetoes(allDecisions),
    markets: await enrichMarketLabelFields(harvest.details.map((detail) => detail.result)),
  };
}
