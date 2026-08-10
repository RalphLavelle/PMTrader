import { config } from '../config.js';
import { getMarketLabels } from '../collector/store.js';
import { loadMarketSnapshots } from '../features/coverage.js';
import type { AnalysisMemoryStore } from '../memory/index.js';
import type { SwarmAnalysisResult } from '../schemas/index.js';
import { findExitSnapshot, fixedHoldPolicy } from '../trading/index.js';
import {
  buildIntramarketTradeOutcome,
  buildTradeOutcome,
} from './scoring.js';
import type { RunLabellingResult } from './types.js';

/**
 * Carrying outcomes across to PMTrader's own analysis runs.
 *
 * Primary path: once enough later snapshots exist, score the run as an
 * intramarket trade (entry at the run's quote → exit after the hold window).
 *
 * Secondary path: if the market has resolved and no exit is available yet,
 * fall back to hold-to-settlement PnL so older runs are not left unscored forever.
 */

/** Decisive yes/no results for the given markets, keyed by market id. */
async function loadDecisiveResults(marketIds: string[]): Promise<Map<string, 'yes' | 'no'>> {
  if (marketIds.length === 0) {
    return new Map();
  }

  const labels = await getMarketLabels()
    .find(
      { marketId: { $in: marketIds }, result: { $in: ['yes', 'no'] } },
      { projection: { marketId: 1, result: 1 } },
    )
    .toArray();

  const results = new Map<string, 'yes' | 'no'>();
  for (const label of labels) {
    if (label.result === 'yes' || label.result === 'no') {
      results.set(label.marketId, label.result);
    }
  }
  return results;
}

/** Hold window used when scoring live runs (matches backtest default). */
function runExitHoldMinutes(): number {
  return (
    config.backtestExitHoldMinutes ??
    config.backtestDecisionIntervalMinutes ??
    15
  );
}

/** Score one run intramarket when an exit exists; else resolution if known. */
async function labelRun(
  store: AnalysisMemoryStore,
  run: SwarmAnalysisResult,
  resolvedTo: 'yes' | 'no' | null,
): Promise<boolean> {
  const holdMinutes = runExitHoldMinutes();
  const policy = fixedHoldPolicy(holdMinutes);
  const entryMs = new Date(run.record.timestamp).getTime();

  // Load enough later snapshots to cover the hold window.
  const snapshots = await loadMarketSnapshots(run.record.marketId, 500);
  const exitDoc = findExitSnapshot(snapshots, entryMs, policy);

  if (exitDoc) {
    const outcome = buildIntramarketTradeOutcome({
      record: run.record,
      entry: run.snapshot,
      exit: {
        buyYesPriceUsd: exitDoc.buyYesPriceUsd,
        buyNoPriceUsd: exitDoc.buyNoPriceUsd,
      },
      exitAt: exitDoc.capturedAt,
      holdMinutes,
      resolvedTo,
    });
    const updated = await store.recordOutcome(run.record.id, outcome);
    return updated !== null;
  }

  // No exit quote yet — only fall back to resolution scoring.
  if (!resolvedTo) {
    return false;
  }

  const outcome = buildTradeOutcome(run.record, run.snapshot, resolvedTo);
  const updated = await store.recordOutcome(run.record.id, outcome);
  return updated !== null;
}

/**
 * Attach outcomes to stored runs that can now be scored.
 *
 * A run becomes scorable when either:
 * - a later snapshot exists after the hold window (intramarket — preferred), or
 * - its market has a decisive resolution label (secondary fallback).
 */
export async function applyLabelsToRuns(options: {
  store: AnalysisMemoryStore;
  limit: number;
}): Promise<RunLabellingResult> {
  const { store, limit } = options;
  const errors: string[] = [];

  const pending = await store.listPendingOutcomes(limit);
  if (pending.length === 0) {
    return { scanned: 0, labelled: 0, errors };
  }

  const marketIds = [...new Set(pending.map((run) => run.record.marketId))];
  const results = await loadDecisiveResults(marketIds);

  let labelled = 0;
  for (const run of pending) {
    const resolvedTo = results.get(run.record.marketId) ?? null;

    try {
      if (await labelRun(store, run, resolvedTo)) {
        labelled += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Run ${run.record.id}: ${message}`);
    }
  }

  return { scanned: pending.length, labelled, errors };
}
