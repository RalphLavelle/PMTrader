import {
  proposedTradeSchema,
  type AgentName,
  type AgentSignal,
  type ProposedTrade,
} from '../../schemas/index.js';

/**
 * Signal aggregation — pure functions shared by the Risk Manager.
 *
 * Split out from the risk rules so the "how do we combine opinions" question can
 * be tested and tuned independently of the "should we trade" question.
 */

/** How far the blended probability must sit from 0.5 before a side is worth taking. */
const DECISION_MARGIN = 0.03;

/**
 * Convert a signal into the probability of YES it implies.
 *
 * A maximally confident YES maps to 1.0, a maximally confident NO to 0.0, and
 * anything neutral or unconvinced sits at 0.5.
 *
 * Exported because Phase 5 grades each specialist's stance as a probabilistic
 * forecast, and it must read a stance exactly the way the Risk Manager does.
 * Two different mappings would mean fitness scored an opinion the swarm never
 * actually held. The parameter is narrowed to the two fields it needs so a
 * replayed signal (which carries no reasoning or timestamp) fits too.
 */
export function signalToYesProbability(
  signal: Pick<AgentSignal, 'stance' | 'confidence'>,
): number {
  switch (signal.stance) {
    case 'yes':
      return 0.5 + 0.5 * signal.confidence;
    case 'no':
      return 0.5 - 0.5 * signal.confidence;
    case 'neutral':
      return 0.5;
  }
}

/**
 * Measure how much the agents agreed, scored 0..1.
 *
 * 1 means every confident agent pointed the same way; 0 means the yes and no
 * camps carried exactly equal weight. Neutral signals contribute no weight, so
 * they neither create nor resolve disagreement.
 */
function calculateAgreement(signals: AgentSignal[]): number {
  let yesWeight = 0;
  let noWeight = 0;

  for (const signal of signals) {
    if (signal.stance === 'yes') {
      yesWeight += signal.confidence;
    } else if (signal.stance === 'no') {
      noWeight += signal.confidence;
    }
  }

  const directionalWeight = yesWeight + noWeight;
  if (directionalWeight === 0) {
    return 0;
  }

  return Math.abs(yesWeight - noWeight) / directionalWeight;
}

/**
 * Blend every specialist signal into a single proposed trade.
 *
 * Confidence-weighting matters here: the trend and mean-reversion agents are
 * designed to disagree, and weighting by conviction lets the more confident of
 * the two dominate rather than the two simply cancelling out.
 */
export function aggregateSignals(marketId: string, signals: AgentSignal[]): ProposedTrade {
  const contributingAgents: AgentName[] = signals.map((signal) => signal.agent);

  // Guard both the empty case and the all-neutral case, where every weight is 0
  // and a weighted mean would divide by zero.
  const totalWeight = signals.reduce((sum, signal) => sum + signal.confidence, 0);

  if (signals.length === 0 || totalWeight === 0) {
    return proposedTradeSchema.parse({
      marketId,
      recommendation: 'hold',
      yesLikelihood: 0.5,
      confidence: 0,
      contributingAgents: contributingAgents.length > 0 ? contributingAgents : ['risk_manager'],
    });
  }

  const weightedProbability =
    signals.reduce(
      (sum, signal) => sum + signalToYesProbability(signal) * signal.confidence,
      0,
    ) / totalWeight;

  const meanConfidence = totalWeight / signals.length;
  const agreement = calculateAgreement(signals);

  // Disagreement is priced in directly: two equally confident, opposing agents
  // produce a near-zero final confidence even though each was individually sure.
  const confidence = clamp01(meanConfidence * agreement);

  return proposedTradeSchema.parse({
    marketId,
    recommendation: chooseRecommendation(weightedProbability, confidence),
    yesLikelihood: clamp01(weightedProbability),
    confidence,
    contributingAgents,
  });
}

/** Pick a side only when the blend is both off-centre and backed by conviction. */
function chooseRecommendation(
  yesLikelihood: number,
  confidence: number,
): ProposedTrade['recommendation'] {
  if (confidence <= 0) {
    return 'hold';
  }
  if (yesLikelihood > 0.5 + DECISION_MARGIN) {
    return 'buy_yes';
  }
  if (yesLikelihood < 0.5 - DECISION_MARGIN) {
    return 'buy_no';
  }
  return 'hold';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
