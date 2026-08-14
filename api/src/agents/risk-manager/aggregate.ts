import {
  proposedTradeSchema,
  type AgentName,
  type AgentSignal,
  type ProposedTrade,
} from '../../schemas/index.js';
import type { AgentWeightMap } from '../../adaptive/types.js';
import { BASELINE_WEIGHT } from '../../adaptive/types.js';
import { config } from '../../config.js';

/**
 * Signal aggregation — pure functions shared by the Risk Manager.
 *
 * Split out from the risk rules so the "how do we combine opinions" question can
 * be tested and tuned independently of the "should we trade" question.
 *
 * Phase 6: each specialist's self-reported confidence is scaled by an adaptive
 * influence weight derived from coherent paper-trade fitness — not by raw win
 * rate. Missing weights default to the baseline of 1.0.
 *
 * When directional specialists disagree (yes vs no), the default policy follows
 * the higher-weight agent instead of averaging to a near-zero confidence hold.
 */

/** How far the blended probability must sit from 0.5 before a side is worth taking. */
const DECISION_MARGIN = 0.03;

export type DisagreementPolicy = 'follow_heavier' | 'average';

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
 * When yes and no both appear among directional specialists, pick one leader.
 *
 * Higher adaptive weight wins; tie → higher self-reported confidence; still
 * tied → null (honest hold). Semantic neutrals are ignored.
 */
export function pickDisagreementLeader(
  signals: AgentSignal[],
  weights?: AgentWeightMap,
): AgentSignal | null {
  const yesSignals = signals.filter((s) => s.stance === 'yes');
  const noSignals = signals.filter((s) => s.stance === 'no');
  if (yesSignals.length === 0 || noSignals.length === 0) {
    return null;
  }

  const directional = [...yesSignals, ...noSignals];
  directional.sort((left, right) => {
    const weightDiff =
      agentInfluence(right.agent, weights) - agentInfluence(left.agent, weights);
    if (weightDiff !== 0) {
      return weightDiff;
    }
    return right.confidence - left.confidence;
  });

  const leader = directional[0];
  const runnerUp = directional[1];
  if (!leader || !runnerUp) {
    return null;
  }

  // Exact tie on both weight and confidence → stand aside.
  if (
    agentInfluence(leader.agent, weights) === agentInfluence(runnerUp.agent, weights) &&
    leader.confidence === runnerUp.confidence &&
    leader.stance !== runnerUp.stance
  ) {
    return null;
  }

  return leader;
}

/**
 * Blend every specialist signal into a single proposed trade.
 *
 * Confidence still matters: conviction lets a sure agent outvote a tentative
 * one. Adaptive weights then scale that voice by measured trading fitness.
 *
 * On directional disagreement with `follow_heavier` (default), the proposal
 * follows the higher-weight specialist's side and *own* confidence — Risk
 * Manager still applies the paper/swarm confidence floor afterward.
 */
export function aggregateSignals(
  marketId: string,
  signals: AgentSignal[],
  weights?: AgentWeightMap,
  disagreementPolicy?: DisagreementPolicy,
): ProposedTrade {
  const contributingAgents: AgentName[] = signals.map((signal) => signal.agent);
  const policy =
    disagreementPolicy ??
    (config.paperDisagreementPolicy === 'average' ? 'average' : 'follow_heavier');

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

  // Follow-heavier: opposing directional specialists → use the leader alone.
  if (policy === 'follow_heavier') {
    const leader = pickDisagreementLeader(signals, weights);
    if (leader) {
      const yesLikelihood = signalToYesProbability(leader);
      return proposedTradeSchema.parse({
        marketId,
        recommendation: chooseRecommendation(yesLikelihood, leader.confidence),
        yesLikelihood: clamp01(yesLikelihood),
        confidence: clamp01(leader.confidence),
        contributingAgents,
      });
    }
    // Exact tie with opposite stances → honest hold.
    const hasYes = signals.some((s) => s.stance === 'yes');
    const hasNo = signals.some((s) => s.stance === 'no');
    if (hasYes && hasNo) {
      return proposedTradeSchema.parse({
        marketId,
        recommendation: 'hold',
        yesLikelihood: 0.5,
        confidence: 0,
        contributingAgents,
      });
    }
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
