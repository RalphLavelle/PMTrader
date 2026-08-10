import type { Recommendation } from '../schemas/index.js';
import type {
  CalibrationBucket,
  PerformanceStats,
  ScoredDecision,
  VetoTally,
} from './types.js';

/**
 * Turning a pile of graded decisions into numbers a human can act on.
 *
 * Primary accuracy = share of directional bets that were *profitable* under
 * the exit policy. Resolution accuracy is reported separately when known.
 */

/** The common shape of any bet, so strategy and baseline share one summariser. */
interface GradedBet {
  recommendation: Recommendation;
  stakedUsd: number;
  wasProfitable: boolean | null;
  wasCorrect: boolean | null;
  realizedPnlUsd: number | null;
}

/**
 * The least a forecast must carry to be calibrated: a stated P(YES) and the
 * answer. Kept minimal so Phase 5 can calibrate a single agent's stance with
 * the same function that calibrates the whole swarm's blend.
 */
export interface CalibratableForecast {
  yesLikelihood: number;
  resolvedTo: 'yes' | 'no';
}

/** How many calibration bands to split 0..1 into. */
const CALIBRATION_BUCKETS = 10;

/** Distinct veto reasons reported before the tail is cut off. */
const MAX_VETO_REASONS = 8;

/** Round money to cents so summed floating-point noise does not surface. */
function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Roll a set of bets up into headline statistics.
 *
 * Stakes only count toward `totalStakedUsd` when PnL could be calculated.
 */
export function summarisePerformance(bets: GradedBet[]): PerformanceStats {
  let directionalDecisions = 0;
  let holdDecisions = 0;
  let profitableDecisions = 0;
  let unprofitableDecisions = 0;
  let correctDecisions = 0;
  let incorrectDecisions = 0;
  let unscorable = 0;
  let totalStakedUsd = 0;
  let totalPnlUsd = 0;

  for (const bet of bets) {
    if (bet.recommendation === 'hold') {
      holdDecisions += 1;
      continue;
    }

    directionalDecisions += 1;

    if (bet.wasProfitable === true) {
      profitableDecisions += 1;
    } else if (bet.wasProfitable === false) {
      unprofitableDecisions += 1;
    }

    if (bet.wasCorrect === true) {
      correctDecisions += 1;
    } else if (bet.wasCorrect === false) {
      incorrectDecisions += 1;
    }

    if (bet.realizedPnlUsd === null) {
      unscorable += 1;
      continue;
    }

    totalStakedUsd += bet.stakedUsd;
    totalPnlUsd += bet.realizedPnlUsd;
  }

  const traded = profitableDecisions + unprofitableDecisions;
  const resolved = correctDecisions + incorrectDecisions;

  return {
    decisions: bets.length,
    directionalDecisions,
    holdDecisions,
    profitableDecisions,
    unprofitableDecisions,
    accuracy: traded > 0 ? profitableDecisions / traded : null,
    resolutionAccuracy: resolved > 0 ? correctDecisions / resolved : null,
    correctDecisions,
    incorrectDecisions,
    totalStakedUsd: toCents(totalStakedUsd),
    totalPnlUsd: toCents(totalPnlUsd),
    returnOnStake: totalStakedUsd > 0 ? totalPnlUsd / totalStakedUsd : null,
    unscorable,
  };
}

/** Statistics for the strategy's own decisions. */
export function summariseStrategy(decisions: ScoredDecision[]): PerformanceStats {
  return summarisePerformance(
    decisions.map((decision) => ({
      recommendation: decision.recommendation,
      stakedUsd: decision.positionSizeUsd,
      wasProfitable: decision.wasProfitable,
      wasCorrect: decision.wasCorrect,
      realizedPnlUsd: decision.realizedPnlUsd,
    })),
  );
}

/** Statistics for the follow-the-favourite reference strategy. */
export function summariseBaseline(decisions: ScoredDecision[]): PerformanceStats {
  return summarisePerformance(
    decisions.map((decision) => ({
      recommendation: decision.baseline.recommendation,
      stakedUsd: decision.baseline.stakedUsd,
      wasProfitable: decision.baseline.wasProfitable,
      wasCorrect: decision.baseline.wasCorrect,
      realizedPnlUsd: decision.baseline.realizedPnlUsd,
    })),
  );
}

/** Count how often each veto fired, commonest first. */
export function summariseVetoes(decisions: ScoredDecision[]): VetoTally[] {
  const counts = new Map<string, number>();

  for (const decision of decisions) {
    for (const reason of decision.vetoReasons) {
      const key = reason.replace(/-?\d+(\.\d+)?/g, 'N');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, decisions: count }))
    .sort((a, b) => b.decisions - a.decisions)
    .slice(0, MAX_VETO_REASONS);
}

/**
 * Build the calibration curve from the swarm's stated P(YES).
 *
 * Only decisions with a known resolution contribute — calibration needs an
 * answer key. Empty when the sample has not resolved yet.
 */
export function buildCalibration(decisions: CalibratableForecast[]): CalibrationBucket[] {
  const width = 1 / CALIBRATION_BUCKETS;
  const totals = Array.from({ length: CALIBRATION_BUCKETS }, () => ({
    count: 0,
    predictedSum: 0,
    yesCount: 0,
  }));

  for (const decision of decisions) {
    const index = Math.min(
      CALIBRATION_BUCKETS - 1,
      Math.floor(decision.yesLikelihood / width),
    );
    const bucket = totals[index];
    if (!bucket) {
      continue;
    }

    bucket.count += 1;
    bucket.predictedSum += decision.yesLikelihood;
    if (decision.resolvedTo === 'yes') {
      bucket.yesCount += 1;
    }
  }

  return totals
    .map((bucket, index) => ({
      lowerBound: index * width,
      upperBound: (index + 1) * width,
      decisions: bucket.count,
      meanPredicted: bucket.count > 0 ? bucket.predictedSum / bucket.count : 0,
      observedYesRate: bucket.count > 0 ? bucket.yesCount / bucket.count : 0,
    }))
    .filter((bucket) => bucket.decisions > 0);
}
