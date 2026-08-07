import { summariseStances } from './metrics.js';
import type { GradedStance, RegimeDimension, RegimeFitness } from './types.js';

/**
 * Slicing fitness by market conditions.
 *
 * A single accuracy number hides the question Phase 6 actually needs answered.
 * "Trend is 54% accurate" is nearly useless; "Trend is 68% accurate on deep
 * books inside the last hour and 44% on thin overnight markets" is a rule you
 * can act on. Every slice here is chosen because a specialist plausibly behaves
 * differently across it, not because the data happened to be available.
 *
 * Buckets are deliberately coarse. Splitting a small dataset ten ways produces
 * ten meaningless numbers, and a reader is far more likely to over-trust a
 * narrow bucket than a wide one.
 */

/** One bucket definition: how to recognise it, and what it means in English. */
interface BucketRule {
  dimension: RegimeDimension;
  bucket: string;
  description: string;
  matches: (stance: GradedStance) => boolean;
}

/**
 * How far from 50/50 the market itself was sitting.
 *
 * Lopsided markets are easy — following the favourite is nearly free money —
 * so an agent's accuracy there says little. Its record on genuine toss-ups is
 * where any real edge would show up.
 */
function distanceFromEven(stance: GradedStance): number {
  return Math.abs(stance.marketYes - 0.5);
}

/**
 * Every regime bucket, in report order.
 *
 * `liquidityScore` and `hoursToClose` come from `deriveFeatures`, so these
 * boundaries describe the same conditions the live agents saw, not a separate
 * research-only definition.
 */
const BUCKET_RULES: BucketRule[] = [
  {
    dimension: 'liquidity',
    bucket: 'thin',
    description: 'Liquidity score below 0.33 — little depth behind the quote.',
    matches: (s) => s.liquidityScore < 0.33,
  },
  {
    dimension: 'liquidity',
    bucket: 'moderate',
    description: 'Liquidity score 0.33 to 0.66.',
    matches: (s) => s.liquidityScore >= 0.33 && s.liquidityScore < 0.66,
  },
  {
    dimension: 'liquidity',
    bucket: 'deep',
    description: 'Liquidity score 0.66 or above — a book worth trading against.',
    matches: (s) => s.liquidityScore >= 0.66,
  },
  {
    dimension: 'time_to_close',
    bucket: 'hot',
    description: 'Under an hour to close, where prices move fastest.',
    matches: (s) => s.hoursToClose !== null && s.hoursToClose <= 1,
  },
  {
    dimension: 'time_to_close',
    bucket: 'warm',
    description: 'One to twenty-four hours to close.',
    matches: (s) => s.hoursToClose !== null && s.hoursToClose > 1 && s.hoursToClose <= 24,
  },
  {
    dimension: 'time_to_close',
    bucket: 'cold',
    description: 'More than a day to close, where the outcome is still open.',
    matches: (s) => s.hoursToClose !== null && s.hoursToClose > 24,
  },
  {
    dimension: 'time_to_close',
    bucket: 'unknown',
    description: 'No close time was collected, so the horizon is unknown.',
    matches: (s) => s.hoursToClose === null,
  },
  {
    dimension: 'market_conviction',
    bucket: 'toss-up',
    description: 'Market priced within 10 points of even — the hardest calls.',
    matches: (s) => distanceFromEven(s) <= 0.1,
  },
  {
    dimension: 'market_conviction',
    bucket: 'leaning',
    description: 'Market priced 10 to 30 points away from even.',
    matches: (s) => distanceFromEven(s) > 0.1 && distanceFromEven(s) <= 0.3,
  },
  {
    dimension: 'market_conviction',
    bucket: 'lopsided',
    description: 'Market already more than 80/20 — following it is nearly free.',
    matches: (s) => distanceFromEven(s) > 0.3,
  },
  {
    dimension: 'orderbook',
    bucket: 'with-depth',
    description: 'A stored order book backed the decision.',
    matches: (s) => s.hadOrderbook,
  },
  {
    dimension: 'orderbook',
    bucket: 'no-depth',
    description: 'No book was available, so depth-driven signals were blind.',
    matches: (s) => !s.hadOrderbook,
  },
];

/**
 * Score one specialist across every regime bucket.
 *
 * Empty buckets are dropped rather than reported as zeroes: "no stances landed
 * here" and "every stance here was wrong" look identical in a table of zeroes
 * but mean opposite things.
 */
export function summariseRegimes(stances: GradedStance[]): RegimeFitness[] {
  const results: RegimeFitness[] = [];

  for (const rule of BUCKET_RULES) {
    const matched = stances.filter((stance) => rule.matches(stance));
    if (matched.length === 0) {
      continue;
    }

    results.push({
      dimension: rule.dimension,
      bucket: rule.bucket,
      description: rule.description,
      stats: summariseStances(matched),
    });
  }

  return results;
}
