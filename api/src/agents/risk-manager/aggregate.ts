import {
  proposedTradeSchema,
  type AgentName,
  type AgentSignal,
  type ProposedTrade,
} from '../../schemas/index.js';
import type { AgentWeightMap } from '../../adaptive/types.js';
import { BASELINE_WEIGHT } from '../../adaptive/types.js';

/**
 * Signal aggregation — pure functions shared by the Risk Manager.
 *
 * Split out from the risk rules so the "how do we combine opinions" question can
 * be tested and tuned independently of the "should we trade" question.
 *
 * Phase 6: each specialist's self-reported confidence is scaled by an adaptive
 * influence weight derived from coherent paper-trade fitness — not by raw win
 * rate. Missing weights default to the baseline of 1.0.
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

/** Adaptive influence for one agent; baseline when the map has no entry. */
export function agentInfluence(
  agent: AgentName,
  weights: AgentWeightMap | undefined,
): number {
  const weight = weights?.[agent];
  if (weight === undefined || !Number.isFinite(weight) || weight <= 0) {
    return BASELINE_WEIGHT;
  }
  return weight;
}

/**
 * Effective voice of a signal: self-reported confidence × adaptive weight.
 *
 * This is deliberately not "confidence × winRate". The weight is a bounded,
 * sample-shrunk composite fitness score published by the adaptive layer.
 */
export function signalInfluence(
  signal: AgentSignal,
  weights?: AgentWeightMap,
): number {
  return signal.confidence * agentInfluence(signal.agent, weights);
}

/**
 * Measure how much the agents agreed, scored 0..1.
 *
 * Uses adaptive influence so a historically weak specialist cannot manufacture
 * disagreement (or agreement) out of proportion to its earned weight.
 */
function calculateAgreement(signals: AgentSignal[], weights?: AgentWeightMap): number {
  let yesWeight = 0;
  let noWeight = 0;

  for (const signal of signals) {
    const influence = signalInfluence(signal, weights);
    if (signal.stance === 'yes') {
      yesWeight += influence;
    } else if (signal.stance === 'no') {
      noWeight += influence;
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
 * Confidence still matters: conviction lets a sure agent outvote a tentative
 * one. Adaptive weights then scale that voice by measured trading fitness.
 */
export function aggregateSignals(
  marketId: string,
  signals: AgentSignal[],
  weights?: AgentWeightMap,
): ProposedTrade {
  const contributingAgents: AgentName[] = signals.map((signal) => signal.agent);

  const totalWeight = signals.reduce(
    (sum, signal) => sum + signalInfluence(signal, weights),
    0,
  );

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
      (sum, signal) =>
        sum + signalToYesProbability(signal) * signalInfluence(signal, weights),
      0,
    ) / totalWeight;

  const meanConfidence = totalWeight / signals.length;
  const agreement = calculateAgreement(signals, weights);

  // Disagreement is priced in directly: two equally influential, opposing
  // agents produce a near-zero final confidence even though each was sure.
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
