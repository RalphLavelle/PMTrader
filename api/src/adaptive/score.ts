import { maxDrawdownUsd } from '../fitness/trading-metrics.js';
import type { CompletedFitnessTrade } from '../fitness/types.js';
import type { AdaptiveOptions } from './types.js';

/**
 * Deterministic fitness scores from coherent paper trades.
 *
 * Design (why not confidence × win rate):
 *
 * 1. Win rate alone ignores size and risk — a 60% win rate with huge losers
 *    is worse than 55% with small losers. We use return-on-capital and a
 *    drawdown penalty.
 * 2. Raw win rate on 3 trades is noise. We use a Beta(prior, prior) shrinkage
 *    toward 50% so one lucky trade cannot dominate.
 * 3. Self-reported confidence is evidence of *calibration*, not a multiplier
 *    for historical success. We subtract an overconfidence penalty when the
 *    agent was more sure than it was right.
 * 4. Consistency (low return variance) is rewarded so streaky agents do not
 *    get the same boost as steady ones.
 * 5. Recent and long-term scores stay separate; the weight layer blends them.
 *
 * Each score lands roughly in [-1, +1] so the weight transform can stay linear
 * and bounded.
 */

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(max, Math.max(min, value));
}

function sortChronological(trades: CompletedFitnessTrade[]): CompletedFitnessTrade[] {
  return [...trades].sort((a, b) => Date.parse(a.exitAt) - Date.parse(b.exitAt));
}

/** Per-trade return on capital (net P&L / stake). */
function tradeReturn(trade: CompletedFitnessTrade): number {
  if (!(trade.sizeUsd > 0)) {
    return 0;
  }
  return trade.netPnlUsd / trade.sizeUsd;
}

/**
 * Shrunk win rate: (wins + prior) / (decided + 2·prior).
 * Prior of 1 ⇒ one win alone moves rate only to ~0.67, not 1.0.
 */
export function shrunkWinRate(
  trades: CompletedFitnessTrade[],
  prior: number,
): number | null {
  let wins = 0;
  let decided = 0;
  for (const trade of trades) {
    if (trade.netPnlUsd > 0) {
      wins += 1;
      decided += 1;
    } else if (trade.netPnlUsd < 0) {
      decided += 1;
    }
  }
  if (decided === 0) {
    return null;
  }
  const p = Math.max(0, prior);
  return (wins + p) / (decided + 2 * p);
}

/** Mean return on capital across trades. */
export function meanReturnOnCapital(trades: CompletedFitnessTrade[]): number | null {
  if (trades.length === 0) {
    return null;
  }
  const sum = trades.reduce((acc, trade) => acc + tradeReturn(trade), 0);
  return sum / trades.length;
}

/** Sample standard deviation of per-trade returns. */
export function returnStdev(trades: CompletedFitnessTrade[]): number | null {
  if (trades.length < 2) {
    return null;
  }
  const mean = meanReturnOnCapital(trades);
  if (mean === null) {
    return null;
  }
  let sq = 0;
  for (const trade of trades) {
    const diff = tradeReturn(trade) - mean;
    sq += diff * diff;
  }
  return Math.sqrt(sq / (trades.length - 1));
}

/**
 * Consistency in [0, 1]: high when returns cluster; low when wild.
 * Neutral 0.5 when we cannot measure variance yet.
 */
export function consistencyScore(trades: CompletedFitnessTrade[]): number {
  const stdev = returnStdev(trades);
  if (stdev === null) {
    return 0.5;
  }
  // Scale: stdev of 0 → 1; stdev of 0.5 (huge for binary contracts) → ~0.33
  return round(1 / (1 + 2 * stdev));
}

/**
 * Mean specialist confidence at entry (from swarm state signals).
 * Falls back to null when the agent was not in the entry signal list.
 */
export function meanEntryConfidence(
  trades: CompletedFitnessTrade[],
  agent: string,
): number | null {
  let sum = 0;
  let count = 0;
  for (const trade of trades) {
    const signal = trade.swarmStateAtEntry.signals.find((s) => s.agent === agent);
    if (!signal) {
      continue;
    }
    sum += signal.confidence;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

/**
 * Core fitness from a trade set: edge vs 50%, tempered by risk and consistency.
 */
export function scoreTradeSet(
  trades: CompletedFitnessTrade[],
  options: Pick<AdaptiveOptions, 'winRatePrior'>,
  agent: string,
): {
  fitness: number;
  confidenceAdjusted: number;
  consistency: number;
  winRate: number | null;
  roc: number | null;
  drawdownUsd: number;
  pnlUsd: number;
} {
  if (trades.length === 0) {
    return {
      fitness: 0,
      confidenceAdjusted: 0,
      consistency: 0.5,
      winRate: null,
      roc: null,
      drawdownUsd: 0,
      pnlUsd: 0,
    };
  }

  const winRate = shrunkWinRate(trades, options.winRatePrior);
  const roc = meanReturnOnCapital(trades);
  const consistency = consistencyScore(trades);
  const drawdownUsd = maxDrawdownUsd(trades);
  const pnlUsd = trades.reduce((sum, trade) => sum + trade.netPnlUsd, 0);
  const capital = trades.reduce((sum, trade) => sum + trade.sizeUsd, 0);

  // Edge from shrunk win rate (primary direction signal).
  const winEdge = winRate === null ? 0 : winRate - 0.5;

  // Magnitude from average return on capital (capped so outliers don't explode).
  const rocEdge = roc === null ? 0 : clamp(roc, -0.5, 0.5);

  // Drawdown as a fraction of capital deployed — penalise persistent pain.
  const ddFraction = capital > 0 ? clamp(drawdownUsd / capital, 0, 2) : 0;
  const drawdownPenalty = ddFraction * 0.35;

  // Consistency reward centred on 0.5 so average agents are unchanged.
  const consistencyBonus = (consistency - 0.5) * 0.3;

  let fitness = clamp(1.2 * winEdge + 0.8 * rocEdge + consistencyBonus - drawdownPenalty, -1, 1);

  // Confidence-adjusted: penalise agents that were surer than they were right.
  const meanConf = meanEntryConfidence(trades, agent);
  let confidenceAdjusted = fitness;
  if (meanConf !== null && winRate !== null) {
    const overconfidence = Math.max(0, meanConf - winRate);
    confidenceAdjusted = clamp(fitness - overconfidence * 0.5, -1, 1);
  }

  return {
    fitness: round(fitness),
    confidenceAdjusted: round(confidenceAdjusted),
    consistency: round(consistency),
    winRate: winRate === null ? null : round(winRate),
    roc: roc === null ? null : round(roc),
    drawdownUsd,
    pnlUsd: Math.round(pnlUsd * 100) / 100,
  };
}

/** Most recent N trades (by exit time). */
export function recentTrades(
  trades: CompletedFitnessTrade[],
  window: number,
): CompletedFitnessTrade[] {
  const sorted = sortChronological(trades);
  if (window <= 0 || sorted.length <= window) {
    return sorted;
  }
  return sorted.slice(sorted.length - window);
}

export { sortChronological };
