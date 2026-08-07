import { buildCalibration } from '../backtest/index.js';
import type { CalibrationBucket } from '../backtest/index.js';
import type { GradedStance, StanceStats, SuggestedWeight } from './types.js';

/**
 * Scoring specialists — pure functions only.
 *
 * Give them stances, get statistics. Keeping "what does this mean?" separate
 * from "where did the data come from?" is what makes the interesting maths here
 * testable without a database.
 */

/** The Brier score of an uninformative forecast, i.e. always saying 50/50. */
const COIN_FLIP_BRIER = 0.25;

/** How far a weight may travel from neutral, in either direction. */
const WEIGHT_FLOOR = 0.25;
const WEIGHT_CEILING = 1.5;

/** Round a ratio to four places so floating-point tails do not reach the UI. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Squared error of a probabilistic forecast — the Brier score.
 *
 * The outcome is 1 for YES and 0 for NO, so a confident correct call scores
 * near 0 and a confident wrong one scores near 1. Squaring is what makes it a
 * *proper* score: an agent minimises it only by stating what it honestly
 * believes, never by exaggerating. That property is the whole reason Phase 5
 * uses it instead of a plain accuracy count, which rewards bluffing.
 */
export function brier(predictedYes: number, resolvedTo: 'yes' | 'no'): number {
  const actual = resolvedTo === 'yes' ? 1 : 0;
  const error = predictedYes - actual;
  return error * error;
}

/** Was a stance on the winning side? Null for neutral, which took no side. */
export function stanceWasCorrect(stance: GradedStance): boolean | null {
  if (stance.stance === 'neutral') {
    return null;
  }
  return stance.stance === stance.resolvedTo;
}

/**
 * Roll a set of stances up into one specialist's record.
 *
 * Two subtleties worth knowing:
 *
 * 1. **Brier includes neutral stances.** Abstaining is a real forecast of
 *    "50/50", and an agent that abstains on a market that was obvious should
 *    not escape the cost of that.
 * 2. **Accuracy excludes them.** "Of the calls it made, how many were right?"
 *    is a different question, and mixing abstentions into it would let an agent
 *    improve its accuracy by staying quiet.
 */
export function summariseStances(stances: GradedStance[]): StanceStats {
  let directional = 0;
  let neutral = 0;
  let correct = 0;
  let incorrect = 0;
  let confidenceSum = 0;
  let brierSum = 0;
  let marketBrierSum = 0;

  for (const stance of stances) {
    brierSum += brier(stance.predictedYes, stance.resolvedTo);
    marketBrierSum += brier(stance.marketYes, stance.resolvedTo);

    const wasCorrect = stanceWasCorrect(stance);
    if (wasCorrect === null) {
      neutral += 1;
      continue;
    }

    directional += 1;
    confidenceSum += stance.confidence;
    if (wasCorrect) {
      correct += 1;
    } else {
      incorrect += 1;
    }
  }

  const total = stances.length;
  const accuracy = directional > 0 ? correct / directional : null;
  const meanConfidence = directional > 0 ? confidenceSum / directional : null;
  const brierScore = total > 0 ? brierSum / total : null;
  const marketBrierScore = total > 0 ? marketBrierSum / total : null;

  return {
    stances: total,
    directional,
    neutral,
    correct,
    incorrect,
    accuracy: accuracy === null ? null : round(accuracy),
    meanConfidence: meanConfidence === null ? null : round(meanConfidence),
    brierScore: brierScore === null ? null : round(brierScore),
    marketBrierScore: marketBrierScore === null ? null : round(marketBrierScore),
    skillVsMarket: skillScore(brierScore, marketBrierScore),
    overconfidence:
      accuracy === null || meanConfidence === null ? null : round(meanConfidence - accuracy),
  };
}

/**
 * How much better than a reference forecaster the agent was.
 *
 * `1 − ours / theirs`: zero means "exactly as good as the price", positive
 * means the agent added information, negative means reading the price would
 * have served us better. A reference score of zero means the market was already
 * perfect, and nothing can improve on that, so there is no skill to report.
 */
function skillScore(ours: number | null, reference: number | null): number | null {
  if (ours === null || reference === null || reference <= 0) {
    return null;
  }
  return round(1 - ours / reference);
}

/** Calibration curve for one specialist's stated probabilities. */
export function buildStanceCalibration(stances: GradedStance[]): CalibrationBucket[] {
  return buildCalibration(
    stances.map((stance) => ({
      yesLikelihood: stance.predictedYes,
      resolvedTo: stance.resolvedTo,
    })),
  );
}

/**
 * Turn a record into the confidence multiplier Phase 6 would apply.
 *
 * Anchored at 1.0 — "trust this specialist exactly as much as it asks to be
 * trusted" — and moved by how much it beat the market price. Beating the price
 * by 20% earns a 1.2; being 20% worse than the price earns a 0.8. The clamps
 * stop one lucky streak from handing an agent runaway influence.
 *
 * Skill against the *market* rather than against a coin flip is the right
 * anchor: an agent that is only right because the favourite usually wins has
 * added nothing PMTrader could not get by reading the price for free.
 *
 * Below `minSample` the weight is pinned at neutral. A handful of stances can
 * produce a spectacular skill score by luck alone, and Phase 6 acting on that
 * would be worse than Phase 6 doing nothing at all.
 */
export function suggestWeight(
  stats: StanceStats,
  minSample: number,
): SuggestedWeight {
  const sampleSize = stats.stances;

  if (sampleSize < minSample) {
    return {
      weight: 1,
      reliable: false,
      sampleSize,
      rationale: `Only ${sampleSize} graded stances; ${minSample} are needed before a weight means anything.`,
    };
  }

  if (stats.skillVsMarket === null) {
    return {
      weight: 1,
      reliable: false,
      sampleSize,
      rationale: 'The market price was already a perfect forecast, so there is no skill to measure against it.',
    };
  }

  const weight = round(
    Math.min(WEIGHT_CEILING, Math.max(WEIGHT_FLOOR, 1 + stats.skillVsMarket)),
  );

  const verdict =
    stats.skillVsMarket > 0
      ? `beat the market price by ${(stats.skillVsMarket * 100).toFixed(1)}%`
      : `trailed the market price by ${(Math.abs(stats.skillVsMarket) * 100).toFixed(1)}%`;

  return {
    weight,
    reliable: true,
    sampleSize,
    rationale: `Over ${sampleSize} stances this agent ${verdict} on Brier score.`,
  };
}

/** Whether the coin-flip reference is worth mentioning for a set of stances. */
export function beatsCoinFlip(stats: StanceStats): boolean | null {
  return stats.brierScore === null ? null : stats.brierScore < COIN_FLIP_BRIER;
}
