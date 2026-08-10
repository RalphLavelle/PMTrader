import { evaluateMeanReversion } from '../agents/mean-reversion/logic.js';
import { AGENT_NAMES } from '../agents/names.js';
import { aggregateSignals } from '../agents/risk-manager/aggregate.js';
import { assessRisk, buildRecommendation, type RiskLimits } from '../agents/risk-manager/logic.js';
import { evaluateTrend } from '../agents/trend/logic.js';
import { getAgentWeightMap } from '../adaptive/index.js';
import type { AgentName, MarketSnapshot } from '../schemas/index.js';
import type { DecisionPoint } from './history.js';
import type { ReplayedDecision } from './types.js';

/**
 * Replaying the swarm's decision logic at a past moment.
 *
 * This imports agent logic directly rather than going through the swarm
 * pipeline, which keeps the architectural rule intact: business logic never
 * touches LangGraph, so the backtest stays a plain, fast, synchronous loop.
 *
 * When adaptive weights have been published (after a fitness pass), replay uses
 * them so the feedback loop is visible offline as well as live.
 */

/**
 * The specialists that take part in a replay.
 *
 * The semantic agent is missing on purpose, for three separate reasons:
 *
 * 1. It calls a language model, so replaying tens of thousands of decision
 *    points would take hours and cost money.
 * 2. It is not deterministic, so the same history would score differently on
 *    every run and nothing could be attributed to a code change.
 * 3. It reads the market's resolution rules, and the collector never stored
 *    them — feeding it today's rules for a market that has already settled
 *    would hand it a hint the live agent never had.
 *
 * What is measured here is therefore the *quantitative core* of the swarm, not
 * the whole swarm. That distinction matters when reading the results.
 */
export const REPLAY_AGENTS: AgentName[] = [AGENT_NAMES.trend, AGENT_NAMES.meanReversion];

/** The price a position would have been opened at, or null when holding. */
function entryPrice(
  recommendation: ReplayedDecision['recommendation'],
  snapshot: MarketSnapshot,
): number | null {
  if (recommendation === 'buy_yes') {
    return snapshot.buyYesPriceUsd;
  }
  if (recommendation === 'buy_no') {
    return snapshot.buyNoPriceUsd;
  }
  return null;
}

/**
 * Run the full decision chain against one historical snapshot.
 *
 * Uses the DecisionPoint's canonical MarketContext so replay sees the same
 * as-of-T history the live swarm would have seen. `now` is always the
 * snapshot's capturedAt — never wall-clock "today".
 */
export function replayDecision(point: DecisionPoint, limits: RiskLimits): ReplayedDecision {
  const { snapshot, hadOrderbook, context } = point;
  const now = new Date(context.at);
  const features = context.features;

  const signals = [
    evaluateTrend(snapshot, features, now, context),
    evaluateMeanReversion(snapshot, features, now, context),
  ];

  const weights = getAgentWeightMap();
  const proposal = aggregateSignals(snapshot.marketId, signals, weights);
  const assessment = assessRisk(proposal, snapshot, features, limits, now, context);
  const recommendation = buildRecommendation(proposal, assessment, now);

  return {
    marketId: snapshot.marketId,
    decidedAt: snapshot.capturedAt,
    recommendation: recommendation.recommendation,
    approved: assessment.approved,
    confidence: recommendation.confidence,
    yesLikelihood: recommendation.yesLikelihood,
    positionSizeUsd: recommendation.positionSizeUsd,
    entryPriceUsd: entryPrice(recommendation.recommendation, snapshot),
    impliedYesProbability: features.impliedYesProbability,
    liquidityScore: features.liquidityScore,
    hoursToClose: features.hoursToClose,
    hadOrderbook,
    vetoReasons: assessment.vetoReasons,
    signals: signals.map((signal) => ({
      agent: signal.agent,
      stance: signal.stance,
      confidence: signal.confidence,
    })),
  };
}
