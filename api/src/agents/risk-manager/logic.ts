import type { MarketContext } from '../../features/context.js';
import {
  riskAssessmentSchema,
  swarmRecommendationSchema,
  type DerivedFeatures,
  type MarketSnapshot,
  type ProposedTrade,
  type RiskAssessment,
  type SwarmRecommendation,
} from '../../schemas/index.js';

/**
 * Risk Manager business logic — pure, deterministic, no LangGraph and no LLM.
 *
 * This is the only place in the swarm that decides whether real money should be
 * put at risk, so every rule is explicit and every veto carries a reason.
 */

/** Below this liquidity score an order is unlikely to fill at a sensible price. */
const MIN_LIQUIDITY_SCORE = 0.15;

/** Markets closing sooner than this earn a warning; there is little time to be wrong. */
const CLOSE_SOON_HOURS = 6;

/** A spread wider than this is worth flagging to the operator. */
const WIDE_SPREAD_USD = 0.05;

/** Tunable limits, injected so tests can exercise the rules without env vars. */
export interface RiskLimits {
  maxPositionUsd: number;
  minPositionUsd: number;
  minConfidence: number;
}

/**
 * Apply the veto rules and size the position.
 *
 * Vetoes are collected rather than short-circuited: an operator reading the
 * result should see every reason a trade was rejected, not just the first.
 */
export function assessRisk(
  proposal: ProposedTrade,
  snapshot: MarketSnapshot,
  features: DerivedFeatures,
  limits: RiskLimits,
  now: Date = new Date(),
  /** Canonical as-of-T context — available for later rules; unused by scoring yet. */
  _context?: MarketContext,
): RiskAssessment {
  const vetoReasons: string[] = [];
  const warnings: string[] = [];

  if (snapshot.status !== 'open') {
    vetoReasons.push(`Market status is "${snapshot.status}", so it cannot be traded.`);
  }

  if (proposal.recommendation === 'hold') {
    vetoReasons.push('Agents did not converge on a direction, so there is nothing to size.');
  }

  if (proposal.confidence < limits.minConfidence) {
    vetoReasons.push(
      `Blended confidence ${proposal.confidence.toFixed(2)} is below the ` +
        `${limits.minConfidence.toFixed(2)} threshold.`,
    );
  }

  if (features.liquidityScore < MIN_LIQUIDITY_SCORE) {
    vetoReasons.push(
      `Liquidity score ${features.liquidityScore.toFixed(2)} is too low to fill an order safely.`,
    );
  }

  if (features.hoursToClose !== null && features.hoursToClose <= 0) {
    vetoReasons.push('Market has reached its close time.');
  }

  // Size first, then let an undersized position become its own veto — that keeps
  // the "too small to bother" rule in one place instead of duplicating the maths.
  const positionSizeUsd = calculatePositionSize(proposal, features, limits);

  if (vetoReasons.length === 0 && positionSizeUsd < limits.minPositionUsd) {
    vetoReasons.push(
      `Sized position $${positionSizeUsd.toFixed(2)} falls below the ` +
        `$${limits.minPositionUsd.toFixed(2)} minimum order.`,
    );
  }

  if (features.hoursToClose !== null && features.hoursToClose > 0 && features.hoursToClose < CLOSE_SOON_HOURS) {
    warnings.push(`Only ${features.hoursToClose.toFixed(1)}h remain before the market closes.`);
  }

  if (features.spreadUsd > WIDE_SPREAD_USD) {
    warnings.push(`Spread of $${features.spreadUsd.toFixed(3)} will erode any edge.`);
  }

  if (proposal.contributingAgents.length < 2) {
    warnings.push('Fewer than two specialists contributed, so the blend is weakly supported.');
  }

  const approved = vetoReasons.length === 0;

  return riskAssessmentSchema.parse({
    approved,
    vetoReasons,
    warnings,
    positionSizeUsd: approved ? positionSizeUsd : 0,
    maxPositionUsd: limits.maxPositionUsd,
    riskScore: calculateRiskScore(proposal, features),
    assessedAt: now.toISOString(),
  });
}

/**
 * Scale the stake by conviction and by how tradeable the market is.
 *
 * Confidence is measured *above* the approval threshold so that a trade which
 * only just qualifies is staked conservatively rather than at full size.
 */
function calculatePositionSize(
  proposal: ProposedTrade,
  features: DerivedFeatures,
  limits: RiskLimits,
): number {
  if (proposal.recommendation === 'hold') {
    return 0;
  }

  const headroom = 1 - limits.minConfidence;
  const confidenceAboveThreshold =
    headroom > 0 ? clamp01((proposal.confidence - limits.minConfidence) / headroom) : 0;

  // A floor of 0.25 means a barely-approved trade still takes a real (if small)
  // position instead of rounding away to nothing.
  const convictionScale = 0.25 + 0.75 * confidenceAboveThreshold;
  const rawSize = limits.maxPositionUsd * convictionScale * features.liquidityScore;

  const capped = Math.min(limits.maxPositionUsd, Math.max(0, rawSize));
  return Math.round(capped * 100) / 100;
}

/** Blend the three things that can go wrong into a single 0..1 risk score. */
function calculateRiskScore(proposal: ProposedTrade, features: DerivedFeatures): number {
  const liquidityRisk = 1 - features.liquidityScore;
  const convictionRisk = 1 - proposal.confidence;
  const timeRisk =
    features.hoursToClose === null
      ? 0.5
      : clamp01(1 - features.hoursToClose / (CLOSE_SOON_HOURS * 4));

  return clamp01(0.4 * liquidityRisk + 0.3 * convictionRisk + 0.3 * timeRisk);
}

/** Turn a proposal plus its risk assessment into the swarm's final answer. */
export function buildRecommendation(
  proposal: ProposedTrade,
  assessment: RiskAssessment,
  now: Date = new Date(),
): SwarmRecommendation {
  const approved = assessment.approved;

  const rationale = approved
    ? `Approved: ${describeSide(proposal)} at ${(proposal.yesLikelihood * 100).toFixed(1)}% ` +
      `implied yes with blended confidence ${proposal.confidence.toFixed(2)}. ` +
      `Staking $${assessment.positionSizeUsd.toFixed(2)} (risk score ` +
      `${assessment.riskScore.toFixed(2)}).` +
      formatWarnings(assessment.warnings)
    : `Vetoed by the Risk Manager. ${assessment.vetoReasons.join(' ')}`;

  return swarmRecommendationSchema.parse({
    marketId: proposal.marketId,
    recommendation: approved ? proposal.recommendation : 'hold',
    yesLikelihood: proposal.yesLikelihood,
    confidence: proposal.confidence,
    positionSizeUsd: assessment.positionSizeUsd,
    rationale,
    decidedAt: now.toISOString(),
  });
}

function describeSide(proposal: ProposedTrade): string {
  return proposal.recommendation === 'buy_yes' ? 'buy YES' : 'buy NO';
}

function formatWarnings(warnings: string[]): string {
  return warnings.length > 0 ? ` Warnings: ${warnings.join(' ')}` : '';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
