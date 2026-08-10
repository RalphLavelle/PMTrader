import { runBacktest } from './engine.js';
import { runPaperReplay } from './paper-engine.js';
import type { PaperReplayOptions, PaperReplaySummary } from './paper-types.js';
import type { BacktestOptions, BacktestSummary } from './types.js';

/**
 * Guarding and remembering backtest / paper-replay runs.
 *
 * Unlike the collector and the labeller there is no timer here. A backtest
 * makes no Jupiter calls and answers a question you ask deliberately ("is the
 * strategy any good on what we have collected so far?"), so running it on a
 * schedule would just burn CPU producing a report nobody read.
 *
 * What it does need is an in-flight guard. A full replay walks every snapshot
 * of every market, and two overlapping runs would double the database load
 * for no extra information.
 */

let lastSummary: BacktestSummary | null = null;
let lastPaperSummary: PaperReplaySummary | null = null;
let runInFlight = false;

/** True while a backtest or paper replay is running. */
export function isBacktestRunning(): boolean {
  return runInFlight;
}

/** The most recent completed Phase 4 backtest, or null if none since boot. */
export function getLastBacktest(): BacktestSummary | null {
  return lastSummary;
}

/** The most recent completed paper replay, or null if none since boot. */
export function getLastPaperReplay(): PaperReplaySummary | null {
  return lastPaperSummary;
}

/**
 * Run one Phase 4 backtest, refusing to start a second while any replay is going.
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

/**
 * Run one paper-trading replay batch with the same in-flight guard.
 */
export async function runPaperReplayOnce(
  overrides?: Partial<PaperReplayOptions>,
): Promise<PaperReplaySummary> {
  if (runInFlight) {
    throw new Error('A backtest or paper replay is already running.');
  }

  runInFlight = true;
  try {
    const summary = await runPaperReplay(overrides);
    lastPaperSummary = summary;
    return summary;
  } finally {
    runInFlight = false;
  }
}
