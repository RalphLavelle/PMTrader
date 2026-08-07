import { runBacktest } from './engine.js';
import type { BacktestOptions, BacktestSummary } from './types.js';

/**
 * Guarding and remembering backtest runs.
 *
 * Unlike the collector and the labeller there is no timer here. A backtest
 * makes no Jupiter calls and answers a question you ask deliberately ("is the
 * strategy any good on what we have collected so far?"), so running it on a
 * schedule would just burn CPU producing a report nobody read.
 *
 * What it does need is an in-flight guard. A full replay walks every snapshot
 * of every resolved market, and two overlapping runs would double the database
 * load for no extra information.
 */

let lastSummary: BacktestSummary | null = null;
let runInFlight = false;

/** True while a backtest is running, so the route can answer 409 instead of piling on. */
export function isBacktestRunning(): boolean {
  return runInFlight;
}

/** The most recent completed backtest, or null if none has run since boot. */
export function getLastBacktest(): BacktestSummary | null {
  return lastSummary;
}

/**
 * Run one backtest, refusing to start a second while the first is going.
 *
 * The `finally` block is what makes the guard safe: if the run throws, the flag
 * still clears, so one failure cannot lock the endpoint out until a restart.
 */
export async function runBacktestOnce(
  overrides?: Partial<BacktestOptions>,
): Promise<BacktestSummary> {
  if (runInFlight) {
    throw new Error('A backtest is already running.');
  }

  runInFlight = true;
  try {
    const summary = await runBacktest(overrides);
    lastSummary = summary;
    return summary;
  } finally {
    runInFlight = false;
  }
}
