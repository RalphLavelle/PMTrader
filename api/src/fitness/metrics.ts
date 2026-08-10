import { buildCalibration } from '../backtest/index.js';
import type { CalibrationBucket } from '../backtest/index.js';
import type {
  GradedStance,
  StanceStats,
  SuggestedWeight,
  TradingPerformance,
} from './types.js';

/**
 * Scoring specialists — pure functions only.
 *
 * Primary metric (elsewhere): coherent paper-trade performance.
 * Secondary here: Brier / resolution forecasting diagnostics.
 */

const COIN_FLIP_BRIER = 0.25;
const WEIGHT_FLOOR = 0.25;
const WEIGHT_CEILING = 1.5;

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Brier score against a known resolution. */
export function brier(predictedYes: number, resolvedTo: 'yes' | 'no'): number {
  const actual = resolvedTo === 'yes' ? 1 : 0;
  const error = predictedYes - actual;
  return error * error;
}

/**
 * Was a stance on the winning *resolution* side?
 * Secondary helper — prefer trading win rate for the primary objective.
 */
export function stanceWasCorrect(stance: GradedStance): boolean | null {
  if (stance.stance === 'neutral' || stance.resolvedTo === null) {
    return null;
  }
  return stance.stance === stance.resolvedTo;
}

/** Secondary success signal for a directional stance-as-trade grade. */
export function stanceWasProfitable(stance: GradedStance): boolean | null {
  if (stance.stance === 'neutral') {
    return null;
  }
  return stance.wasProfitable;
}

/** Roll a set of stances up into forecasting diagnostics. */
export function summariseStances(stances: GradedStance[]): StanceStats {
  let directional = 0;
  let neutral = 0;
  let profitable = 0;
  let unprofitable = 0;
  let correct = 0;
  let incorrect = 0;
  let confidenceSum = 0;
  let tradePnlSum = 0;
  let tradePnlCount = 0;
  let brierSum = 0;
  let marketBrierSum = 0;
  let brierCount = 0;

  for (const stance of stances) {
    if (stance.resolvedTo === 'yes' || stance.resolvedTo === 'no') {
      brierSum += brier(stance.predictedYes, stance.resolvedTo);
      marketBrierSum += brier(stance.marketYes, stance.resolvedTo);
      brierCount += 1;
    }

    if (stance.stance === 'neutral') {
      neutral += 1;
      continue;
    }

    directional += 1;
    confidenceSum += stance.confidence;

    if (stance.tradePnlUsd !== null) {
      tradePnlSum += stance.tradePnlUsd;
      tradePnlCount += 1;
    }

    const traded = stanceWasProfitable(stance);
    if (traded === true) {
      profitable += 1;
    } else if (traded === false) {
      unprofitable += 1;
    }

    const resolved = stanceWasCorrect(stance);
    if (resolved === true) {
      correct += 1;
    } else if (resolved === false) {
      incorrect += 1;
    }
  }

  const traded = profitable + unprofitable;
  const resolved = correct + incorrect;
  const accuracy = traded > 0 ? profitable / traded : null;
  const resolutionAccuracy = resolved > 0 ? correct / resolved : null;
  const meanConfidence = directional > 0 ? confidenceSum / directional : null;
  const meanTradePnlUsd = tradePnlCount > 0 ? tradePnlSum / tradePnlCount : null;
  const brierScore = brierCount > 0 ? brierSum / brierCount : null;
  const marketBrierScore = brierCount > 0 ? marketBrierSum / brierCount : null;

  const skillVsMarket =
    accuracy === null ? skillScore(brierScore, marketBrierScore) : round(accuracy - 0.5);

  return {
    stances: stances.length,
    directional,
    neutral,
    profitable,
    unprofitable,
    accuracy: accuracy === null ? null : round(accuracy),
    resolutionAccuracy: resolutionAccuracy === null ? null : round(resolutionAccuracy),
    correct,
    incorrect,
    meanConfidence: meanConfidence === null ? null : round(meanConfidence),
    meanTradePnlUsd: meanTradePnlUsd === null ? null : round(meanTradePnlUsd),
    brierScore: brierScore === null ? null : round(brierScore),
    marketBrierScore: marketBrierScore === null ? null : round(marketBrierScore),
    skillVsMarket,
    overconfidence:
      accuracy === null || meanConfidence === null ? null : round(meanConfidence - accuracy),
  };
}

function skillScore(ours: number | null, reference: number | null): number | null {
  if (ours === null || reference === null || reference <= 0) {
    return null;
  }
  return round(1 - ours / reference);
}

/** Calibration curve — only stances with a known resolution. */
export function buildStanceCalibration(stances: GradedStance[]): CalibrationBucket[] {
  return buildCalibration(
    stances
      .filter((s) => s.resolvedTo === 'yes' || s.resolvedTo === 'no')
      .map((stance) => ({
        yesLikelihood: stance.predictedYes,
        resolvedTo: stance.resolvedTo as 'yes' | 'no',
      })),
  );
}

/**
 * Confidence multiplier for Phase 6, driven by coherent trading skill when
 * enough closed trades exist, else by secondary resolution Brier skill.
 */
export function suggestWeight(
  trading: TradingPerformance,
  forecasting: StanceStats,
  minSample: number,
): SuggestedWeight {
  const sampleSize = trading.trades > 0 ? trading.trades : forecasting.stances;

  if (trading.trades < minSample && forecasting.stances < minSample) {
    return {
      weight: 1,
      reliable: false,
      sampleSize,
      rationale: `Only ${sampleSize} samples; ${minSample} completed trades (or forecasting stances) are needed before a weight means anything.`,
    };
  }

  // Prefer trading win-rate skill when coherent trades exist.
  if (trading.trades >= minSample && trading.winRate !== null) {
    const skill = round(trading.winRate - 0.5);
    const weight = round(Math.min(WEIGHT_CEILING, Math.max(WEIGHT_FLOOR, 1 + skill)));
    const roc =
      trading.returnOnCapital === null
        ? ''
        : ` return on capital ${(trading.returnOnCapital * 100).toFixed(1)}%,`;
    return {
      weight,
      reliable: true,
      sampleSize: trading.trades,
      rationale: `Over ${trading.trades} coherent paper trades this agent won ${(trading.winRate * 100).toFixed(0)}% of the time,${roc} realised $${trading.realisedPnlUsd.toFixed(2)}.`,
    };
  }

  if (forecasting.skillVsMarket === null) {
    return {
      weight: 1,
      reliable: false,
      sampleSize,
      rationale: 'No trading or resolution skill could be measured for this agent yet.',
    };
  }

  const weight = round(
    Math.min(WEIGHT_CEILING, Math.max(WEIGHT_FLOOR, 1 + forecasting.skillVsMarket)),
  );

  return {
    weight,
    reliable: forecasting.stances >= minSample,
    sampleSize: forecasting.stances,
    rationale: `Too few coherent trades; fell back to forecasting skill ${forecasting.skillVsMarket >= 0 ? '+' : ''}${(forecasting.skillVsMarket * 100).toFixed(1)}% vs the market on Brier.`,
  };
}

export function beatsCoinFlip(stats: StanceStats): boolean | null {
  return stats.brierScore === null ? null : stats.brierScore < COIN_FLIP_BRIER;
}
