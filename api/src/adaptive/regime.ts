import { entryImpliedYes, tradeMatchesRegime } from '../fitness/trading-metrics.js';
import type { CompletedFitnessTrade, RegimeDimension } from '../fitness/types.js';
import type { RegimeContext, RegimeWeightSlice } from './types.js';
import { scoreTradeSet } from './score.js';
import type { AdaptiveOptions } from './types.js';

/**
 * Map a live market snapshot onto the same coarse regime buckets fitness uses.
 */

function distanceFromEven(marketYes: number): number {
  return Math.abs(marketYes - 0.5);
}

export function classifyRegime(context: RegimeContext): Array<{
  dimension: RegimeDimension;
  bucket: string;
}> {
  const slices: Array<{ dimension: RegimeDimension; bucket: string }> = [];

  if (context.liquidityScore < 0.33) {
    slices.push({ dimension: 'liquidity', bucket: 'thin' });
  } else if (context.liquidityScore < 0.66) {
    slices.push({ dimension: 'liquidity', bucket: 'moderate' });
  } else {
    slices.push({ dimension: 'liquidity', bucket: 'deep' });
  }

  if (context.hoursToClose === null) {
    slices.push({ dimension: 'time_to_close', bucket: 'unknown' });
  } else if (context.hoursToClose <= 1) {
    slices.push({ dimension: 'time_to_close', bucket: 'hot' });
  } else if (context.hoursToClose <= 24) {
    slices.push({ dimension: 'time_to_close', bucket: 'warm' });
  } else {
    slices.push({ dimension: 'time_to_close', bucket: 'cold' });
  }

  const distance = distanceFromEven(context.marketYes);
  if (distance <= 0.1) {
    slices.push({ dimension: 'market_conviction', bucket: 'toss-up' });
  } else if (distance <= 0.3) {
    slices.push({ dimension: 'market_conviction', bucket: 'leaning' });
  } else {
    slices.push({ dimension: 'market_conviction', bucket: 'lopsided' });
  }

  slices.push({
    dimension: 'orderbook',
    bucket: context.hadOrderbook ? 'with-depth' : 'no-depth',
  });

  return slices;
}

/**
 * Pick the best-supported regime slice for weighting: prefer the bucket with
 * the most trades among the live market's matching buckets (need ≥ 1).
 */
export function bestRegimeSlice(
  trades: CompletedFitnessTrade[],
  context: RegimeContext,
  options: Pick<AdaptiveOptions, 'winRatePrior'>,
  agent: string,
): RegimeWeightSlice | null {
  const candidates = classifyRegime(context);
  let best: RegimeWeightSlice | null = null;

  for (const candidate of candidates) {
    const matched = trades.filter((trade) =>
      tradeMatchesRegime(trade, candidate.dimension, candidate.bucket),
    );
    if (matched.length === 0) {
      continue;
    }
    const scored = scoreTradeSet(matched, options, agent);
    const slice: RegimeWeightSlice = {
      dimension: candidate.dimension,
      bucket: candidate.bucket,
      sampleCount: matched.length,
      fitness: scored.confidenceAdjusted,
      realisedPnlUsd: scored.pnlUsd,
    };
    if (!best || slice.sampleCount > best.sampleCount) {
      best = slice;
    }
  }

  return best;
}

/** Re-export for callers that need implied yes from a trade's entry. */
export { entryImpliedYes };
