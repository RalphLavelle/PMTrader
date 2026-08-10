import { summariseStances } from './metrics.js';
import { summariseTrades, tradeMatchesRegime } from './trading-metrics.js';
import type {
  CompletedFitnessTrade,
  GradedStance,
  RegimeDimension,
  RegimeFitness,
} from './types.js';

/**
 * Slicing fitness by market conditions.
 *
 * Each bucket reports secondary forecasting stats and, when trades landed there,
 * primary trading performance at entry.
 */

interface BucketRule {
  dimension: RegimeDimension;
  bucket: string;
  description: string;
  matchesStance: (stance: GradedStance) => boolean;
}

function distanceFromEven(stance: GradedStance): number {
  return Math.abs(stance.marketYes - 0.5);
}

const BUCKET_RULES: BucketRule[] = [
  {
    dimension: 'liquidity',
    bucket: 'thin',
    description: 'Liquidity score below 0.33 — little depth behind the quote.',
    matchesStance: (s) => s.liquidityScore < 0.33,
  },
  {
    dimension: 'liquidity',
    bucket: 'moderate',
    description: 'Liquidity score 0.33 to 0.66.',
    matchesStance: (s) => s.liquidityScore >= 0.33 && s.liquidityScore < 0.66,
  },
  {
    dimension: 'liquidity',
    bucket: 'deep',
    description: 'Liquidity score 0.66 or above — a book worth trading against.',
    matchesStance: (s) => s.liquidityScore >= 0.66,
  },
  {
    dimension: 'time_to_close',
    bucket: 'hot',
    description: 'Under an hour to close, where prices move fastest.',
    matchesStance: (s) => s.hoursToClose !== null && s.hoursToClose <= 1,
  },
  {
    dimension: 'time_to_close',
    bucket: 'warm',
    description: 'One to twenty-four hours to close.',
    matchesStance: (s) =>
      s.hoursToClose !== null && s.hoursToClose > 1 && s.hoursToClose <= 24,
  },
  {
    dimension: 'time_to_close',
    bucket: 'cold',
    description: 'More than a day to close, where the outcome is still open.',
    matchesStance: (s) => s.hoursToClose !== null && s.hoursToClose > 24,
  },
  {
    dimension: 'time_to_close',
    bucket: 'unknown',
    description: 'No close time was collected, so the horizon is unknown.',
    matchesStance: (s) => s.hoursToClose === null,
  },
  {
    dimension: 'market_conviction',
    bucket: 'toss-up',
    description: 'Market priced within 10 points of even — the hardest calls.',
    matchesStance: (s) => distanceFromEven(s) <= 0.1,
  },
  {
    dimension: 'market_conviction',
    bucket: 'leaning',
    description: 'Market priced 10 to 30 points away from even.',
    matchesStance: (s) => distanceFromEven(s) > 0.1 && distanceFromEven(s) <= 0.3,
  },
  {
    dimension: 'market_conviction',
    bucket: 'lopsided',
    description: 'Market already more than 80/20 — following it is nearly free.',
    matchesStance: (s) => distanceFromEven(s) > 0.3,
  },
  {
    dimension: 'orderbook',
    bucket: 'with-depth',
    description: 'A stored order book backed the decision.',
    matchesStance: (s) => s.hadOrderbook,
  },
  {
    dimension: 'orderbook',
    bucket: 'no-depth',
    description: 'No book was available, so depth-driven signals were blind.',
    matchesStance: (s) => !s.hadOrderbook,
  },
];

/**
 * Score one specialist across every regime bucket.
 *
 * Empty buckets are dropped. Trading stats attach when coherent trades entered
 * under that condition.
 */
export function summariseRegimes(
  stances: GradedStance[],
  trades: CompletedFitnessTrade[] = [],
): RegimeFitness[] {
  const results: RegimeFitness[] = [];

  for (const rule of BUCKET_RULES) {
    const matchedStances = stances.filter((stance) => rule.matchesStance(stance));
    const matchedTrades = trades.filter((trade) =>
      tradeMatchesRegime(trade, rule.dimension, rule.bucket),
    );

    if (matchedStances.length === 0 && matchedTrades.length === 0) {
      continue;
    }

    results.push({
      dimension: rule.dimension,
      bucket: rule.bucket,
      description: rule.description,
      stats: summariseStances(matchedStances),
      trading: matchedTrades.length > 0 ? summariseTrades(matchedTrades) : null,
    });
  }

  return results;
}
