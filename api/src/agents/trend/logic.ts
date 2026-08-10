import { AGENT_NAMES } from '../names.js';
import type { MarketContext } from '../../features/context.js';
import {
  agentSignalSchema,
  type AgentSignal,
  type DerivedFeatures,
  type MarketSnapshot,
  type Stance,
} from '../../schemas/index.js';

/**
 * Trend Agent business logic — pure, deterministic, no LangGraph and no LLM.
 *
 * Trend following assumes that a market already leaning one way is more likely
 * to keep going that way. In a binary prediction market the two observable
 * signs of that lean are the implied probability itself and the imbalance of
 * resting orders, so both feed the confidence score below.
 */

/** Below this extremity the market is effectively a coin flip and there is no trend to follow. */
const MIN_EXTREMITY_FOR_TREND = 0.06;

/** Weights for the three confidence components; they sum to 1. */
const WEIGHT_EXTREMITY = 0.5;
const WEIGHT_IMBALANCE = 0.3;
const WEIGHT_LIQUIDITY = 0.2;

/**
 * Evaluate a trend-following opportunity.
 *
 * Returns a neutral signal rather than throwing when no edge exists — the Risk
 * Manager needs to see that the agent looked and found nothing, which is
 * different from the agent not running at all.
 */
export function evaluateTrend(
  snapshot: MarketSnapshot,
  features: DerivedFeatures,
  now: Date = new Date(),
  /**
   * Canonical as-of-T market context. Available so agents can later use
   * trajectory / trade-flow; scoring still uses snapshot + features only.
   */
  _context?: MarketContext,
): AgentSignal {
  const generatedAt = now.toISOString();
  const favoursYes = features.impliedYesProbability >= 0.5;

  const supportingMetrics = {
    impliedYesProbability: features.impliedYesProbability,
    priceExtremity: features.priceExtremity,
    depthImbalance: features.depthImbalance,
    liquidityScore: features.liquidityScore,
  };

  // Too close to 50/50 to call a direction.
  if (features.priceExtremity < MIN_EXTREMITY_FOR_TREND) {
    return agentSignalSchema.parse({
      agent: AGENT_NAMES.trend,
      stance: 'neutral' satisfies Stance,
      confidence: 0,
      reasoning:
        `Market "${snapshot.title}" is priced near even ` +
        `(implied yes ${formatPercent(features.impliedYesProbability)}), ` +
        'so there is no established trend to follow.',
      supportingMetrics,
      generatedAt,
    });
  }

  // Depth imbalance is signed toward the yes side, so flip it when the trend is
  // toward no. Mapping -1..1 onto 0..1 lets it act as a plain confirmation score.
  const directionalImbalance = favoursYes ? features.depthImbalance : -features.depthImbalance;
  const imbalanceScore = (directionalImbalance + 1) / 2;

  const confidence = clamp01(
    WEIGHT_EXTREMITY * features.priceExtremity +
      WEIGHT_IMBALANCE * imbalanceScore +
      WEIGHT_LIQUIDITY * features.liquidityScore,
  );

  const stance: Stance = favoursYes ? 'yes' : 'no';
  const confirms = directionalImbalance >= 0;

  return agentSignalSchema.parse({
    agent: AGENT_NAMES.trend,
    stance,
    confidence,
    reasoning:
      `Market is trending ${stance.toUpperCase()} at an implied ` +
      `${formatPercent(features.impliedYesProbability)}. Resting depth ` +
      `${confirms ? 'confirms' : 'contradicts'} that direction ` +
      `(imbalance ${features.depthImbalance.toFixed(2)}), and liquidity scores ` +
      `${features.liquidityScore.toFixed(2)}.`,
    supportingMetrics,
    generatedAt,
  });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
