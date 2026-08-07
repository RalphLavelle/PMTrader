import { config } from '../config.js';
import { analysisMemory } from '../memory/index.js';
import { connectMongo } from '../memory/mongodb.client.js';
import { findLabelCandidates } from './candidates.js';
import { labelMarketFromJupiter } from './market-labels.js';
import { applyLabelsToRuns } from './run-outcomes.js';
import type { LabellerPassResult } from './types.js';

/**
 * The Phase 3 outcome labeller loop.
 *
 * One pass does two things, in order:
 *
 * 1. Ask Jupiter about a small batch of markets that look like they have settled,
 *    and write a label for any that have.
 * 2. Attach those labels to stored swarm runs that are still unscored.
 *
 * Step 2 follows step 1 in the same pass so a market resolving is reflected in
 * the run history immediately rather than an interval later.
 */

/** Most recent pass, surfaced by GET /api/labeller/status. */
let lastPass: LabellerPassResult | null = null;

let timer: NodeJS.Timeout | null = null;
let scheduled = false;
/** Guards against a manual POST /run overlapping the scheduled pass. */
let passInFlight = false;

/** Ask Jupiter about each candidate, stopping at the configured batch size. */
async function labelMarkets(limit: number): Promise<{
  candidatesFound: number;
  checked: number;
  labelled: number;
  errors: string[];
}> {
  const candidates = await findLabelCandidates();
  const batch = candidates.slice(0, limit);
  const errors: string[] = [];
  let labelled = 0;

  for (const candidate of batch) {
    try {
      const attempt = await labelMarketFromJupiter(candidate.marketId);
      if (attempt === 'labelled') {
        labelled += 1;
        console.log(
          `[labeller] Labelled ${candidate.marketId} (${candidate.reason}): ${candidate.title}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`${candidate.marketId}: ${message}`);
    }
  }

  return {
    candidatesFound: candidates.length,
    checked: batch.length,
    labelled,
    errors,
  };
}

/**
 * Run one full labelling pass.
 *
 * Never throws: a pass that fails halfway still returns a result with the error
 * recorded, so the status endpoint can show what went wrong instead of the
 * scheduler dying silently.
 */
export async function runLabellerPass(): Promise<LabellerPassResult> {
  if (passInFlight) {
    throw new Error('A labelling pass is already running.');
  }

  passInFlight = true;
  const startedAt = new Date();
  const errors: string[] = [];

  let markets = { candidatesFound: 0, checked: 0, labelled: 0, errors: [] as string[] };
  let runs = { scanned: 0, labelled: 0, errors: [] as string[] };

  try {
    await connectMongo();

    markets = await labelMarkets(config.labellerMarketBatchSize);
    errors.push(...markets.errors);

    runs = await applyLabelsToRuns({
      store: analysisMemory,
      limit: config.labellerRunBatchSize,
    });
    errors.push(...runs.errors);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    passInFlight = false;
  }

  const finishedAt = new Date();
  lastPass = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    candidatesFound: markets.candidatesFound,
    marketsChecked: markets.checked,
    marketsLabelled: markets.labelled,
    runsScanned: runs.scanned,
    runsLabelled: runs.labelled,
    errors,
  };

  if (markets.labelled > 0 || runs.labelled > 0) {
    console.log(
      `[labeller] Pass complete — ${markets.labelled} market label(s), ${runs.labelled} run outcome(s)`,
    );
  }

  return lastPass;
}

/** The most recent pass, or null when none has run in this process yet. */
export function getLastLabellerPass(): LabellerPassResult | null {
  return lastPass;
}

/** True when a pass is currently executing. */
export function isLabellerPassRunning(): boolean {
  return passInFlight;
}

/**
 * Queue the next pass.
 *
 * A self-rescheduling `setTimeout` is used rather than `setInterval` because the
 * next delay only starts once the current pass has finished. That makes
 * overlapping passes structurally impossible, which is the bug `setInterval`
 * leaves open in the older swarm scheduler (see docs/schedule.md).
 */
function scheduleNextPass(): void {
  timer = setTimeout(() => {
    void runLabellerPass()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[labeller] Pass failed: ${message}`);
      })
      .finally(() => {
        if (scheduled) {
          scheduleNextPass();
        }
      });
  }, config.labellerIntervalMs);
}

/** Start the labeller when LABELLER_ENABLED=true. */
export function startLabeller(): void {
  if (!config.labellerEnabled || scheduled) {
    return;
  }

  scheduled = true;
  const minutes = (config.labellerIntervalMs / 60_000).toFixed(1);
  console.log(
    `[labeller] Started — checking up to ${config.labellerMarketBatchSize} market(s) every ${minutes} min`,
  );
  scheduleNextPass();
}

/** Stop the labeller loop (tests / graceful shutdown). */
export function stopLabeller(): void {
  scheduled = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
