import type { BacktestOptions } from '../backtest/index.js';
import { runFitness } from './engine.js';
import type { FitnessOptions, FitnessReport } from './types.js';

/**
 * Guarding and remembering fitness reports.
 *
 * Same shape as the Phase 4 backtest runner, and for the same reasons: no
 * timer, because a report nobody asked for is CPU spent producing nothing; and
 * an in-flight guard, because a pass replays every resolved market and two
 * overlapping passes would double the database load for identical output.
 *
 * The last report is kept in memory only. It is a derived view, so a restart
 * losing it costs one re-run, not any data.
 */

let lastReport: FitnessReport | null = null;
let runInFlight = false;

/** True while a pass is running, so the route can answer 409 instead of piling on. */
export function isFitnessRunning(): boolean {
  return runInFlight;
}

/** The most recent completed report, or null if none has run since boot. */
export function getLastFitness(): FitnessReport | null {
  return lastReport;
}

/**
 * Run one fitness pass, refusing to start a second while the first is going.
 *
 * The `finally` block is what makes the guard safe: if the pass throws, the
 * flag still clears, so one failure cannot lock the endpoint out until restart.
 */
export async function runFitnessOnce(
  overrides?: Partial<FitnessOptions> & Partial<BacktestOptions>,
): Promise<FitnessReport> {
  if (runInFlight) {
    throw new Error('A fitness pass is already running.');
  }

  runInFlight = true;
  try {
    const report = await runFitness(overrides);
    lastReport = report;
    return report;
  } finally {
    runInFlight = false;
  }
}
