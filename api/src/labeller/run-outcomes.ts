import { getMarketLabels } from '../collector/store.js';
import type { AnalysisMemoryStore } from '../memory/index.js';
import type { SwarmAnalysisResult } from '../schemas/index.js';
import { buildTradeOutcome } from './scoring.js';
import type { RunLabellingResult } from './types.js';

/**
 * Carrying market labels across to PMTrader's own analysis runs.
 *
 * This is the step that actually closes the feedback loop described in
 * docs/Analysis.md. Before Phase 3 a stored run kept `outcome: null` forever
 * unless a human sent a PATCH request; now a resolved market automatically
 * scores every prediction the swarm ever made about it.
 *
 * Layer 2 knowledge (what the market did) becomes Layer 3 knowledge (whether we
 * were right about it) — and Layer 3 is the part no public dataset can provide.
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

/** Score one run and persist the outcome. Returns true when it was updated. */
async function labelRun(
  store: AnalysisMemoryStore,
  run: SwarmAnalysisResult,
  resolvedTo: 'yes' | 'no',
): Promise<boolean> {
  const outcome = buildTradeOutcome(run.record, run.snapshot, resolvedTo);
  const updated = await store.recordOutcome(run.record.id, outcome);
  return updated !== null;
}

/**
 * Attach outcomes to stored runs whose market has since resolved.
 *
 * Reads at most `limit` runs per pass so a long backlog is worked through
 * gradually rather than in one long-running database sweep.
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
    const resolvedTo = results.get(run.record.marketId);
    if (!resolvedTo) {
      continue;
    }

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
