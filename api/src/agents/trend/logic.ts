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
 * The maxim is "trends tend to persist". A genuine trend needs two ingredients:
 *
 * 1. A lean — the market is priced away from 50/50 (point-in-time features).
 * 2. Movement — the price has recently been travelling *toward* that lean
 *    (`context.trajectory`, built strictly from observations at or before T).
 *
 * A market at 70% that is still climbing is a persisting trend. A market at
 * 70% that has been falling all morning is a trend that is breaking, and this
 * agent stands aside rather than backing it. When no price history exists
 * (young market, sparse collector data) the agent falls back to lean-only
 * scoring — its original behaviour — so it still works everywhere.
 */

/** Below this extremity the market is effectively a coin flip and there is no trend to follow. */
const MIN_EXTREMITY_FOR_TREND = 0.06;

/** Weights for the confidence components when momentum is measurable; they sum to 1. */
const WEIGHT_EXTREMITY = 0.35;
const WEIGHT_MOMENTUM = 0.25;
const WEIGHT_IMBALANCE = 0.2;
const WEIGHT_LIQUIDITY = 0.2;

/** Fallback weights when no price history exists (the original scoring); they sum to 1. */
const FALLBACK_WEIGHT_EXTREMITY = 0.5;
const FALLBACK_WEIGHT_IMBALANCE = 0.3;
const FALLBACK_WEIGHT_LIQUIDITY = 0.2;

/** A 5-point probability move over the lookback saturates the momentum score. */
const MOMENTUM_SATURATION = 0.05;

/**
 * The leaning side losing this many probability points over the lookback means
 * the trend is reversing, not persisting — the agent stands aside entirely.
 */
const TREND_BREAK_THRESHOLD = 0.02;

/**
 * Per-snapshot return std-dev at which recent movement is treated as pure
 * noise. Momentum built from wild swings is not a trend, so the momentum
 * score shrinks toward neutral as volatility approaches this ceiling.
 */
const VOLATILITY_CEILING = 0.05;

/** Recent price movement extracted from the as-of-T trajectory. */
interface MomentumReading {
  /** Average change in implied YES probability over 5–10m (signed toward YES). */
  momentum: number;
  /** Std-dev of consecutive returns in the window, or null when too few points. */
  volatility: number | null;
}

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
  /** Canonical as-of-T market context; supplies the price trajectory. */
  context?: MarketContext,
): AgentSignal {
  const generatedAt = now.toISOString();
  const favoursYes = features.impliedYesProbability >= 0.5;
  const reading = measureMomentum(context);

  const supportingMetrics: Record<string, number> = {
    impliedYesProbability: features.impliedYesProbability,
    priceExtremity: features.priceExtremity,
    depthImbalance: features.depthImbalance,
    liquidityScore: features.liquidityScore,
  };
  if (reading !== null) {
    supportingMetrics.momentum = reading.momentum;
    if (reading.volatility !== null) {
      supportingMetrics.volatility = reading.volatility;
    }
  }

  // Too close to 50/50 to call a direction, no matter how the price is moving.
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
  const stance: Stance = favoursYes ? 'yes' : 'no';
  const confirms = directionalImbalance >= 0;
  const depthSentence =
    `Resting depth ${confirms ? 'confirms' : 'contradicts'} that direction ` +
    `(imbalance ${features.depthImbalance.toFixed(2)}), and liquidity scores ` +
    `${features.liquidityScore.toFixed(2)}.`;

  // No usable price history: judge on the current lean alone (original scoring).
  if (reading === null) {
    const confidence = clamp01(
      FALLBACK_WEIGHT_EXTREMITY * features.priceExtremity +
        FALLBACK_WEIGHT_IMBALANCE * imbalanceScore +
        FALLBACK_WEIGHT_LIQUIDITY * features.liquidityScore,
    );
    return agentSignalSchema.parse({
      agent: AGENT_NAMES.trend,
      stance,
      confidence,
      reasoning:
        `Market leans ${stance.toUpperCase()} at an implied ` +
        `${formatPercent(features.impliedYesProbability)}. No recent price ` +
        `history is available, so this is judged on the current lean alone. ` +
        depthSentence,
      supportingMetrics,
      generatedAt,
    });
  }

  // Momentum is signed toward YES; flip it when the lean is toward NO so that
  // positive always means "moving further in the direction of the lean".
  const directionalMomentum = favoursYes ? reading.momentum : -reading.momentum;

  // The favoured side is losing ground fast: the trend is reversing, and a
  // reversing trend is precisely the one "trends persist" says not to follow.
  if (directionalMomentum <= -TREND_BREAK_THRESHOLD) {
    return agentSignalSchema.parse({
      agent: AGENT_NAMES.trend,
      stance: 'neutral' satisfies Stance,
      confidence: 0,
      reasoning:
        `Market leans ${stance.toUpperCase()} at an implied ` +
        `${formatPercent(features.impliedYesProbability)}, but that side has ` +
        `lost ${formatPoints(-directionalMomentum)} over the last 5-10 minutes. ` +
        'The trend is reversing rather than persisting, so the trend agent stands aside.',
      supportingMetrics,
      generatedAt,
    });
  }

  const momentumScore = scoreMomentum(directionalMomentum, reading.volatility);
  supportingMetrics.momentumScore = momentumScore;

  const confidence = clamp01(
    WEIGHT_EXTREMITY * features.priceExtremity +
      WEIGHT_MOMENTUM * momentumScore +
      WEIGHT_IMBALANCE * imbalanceScore +
      WEIGHT_LIQUIDITY * features.liquidityScore,
  );

  const movementSentence =
    directionalMomentum >= 0
      ? `Recent movement supports it: the ${stance.toUpperCase()} side gained ` +
        `${formatPoints(directionalMomentum)} over the last 5-10 minutes.`
      : `Recent movement is slightly against it (the ${stance.toUpperCase()} side ` +
        `gave back ${formatPoints(-directionalMomentum)}), trimming confidence.`;

  return agentSignalSchema.parse({
    agent: AGENT_NAMES.trend,
    stance,
    confidence,
    reasoning:
      `Market is trending ${stance.toUpperCase()} at an implied ` +
      `${formatPercent(features.impliedYesProbability)}. ${movementSentence} ` +
      depthSentence,
    supportingMetrics,
    generatedAt,
  });
}

/**
 * Average the 5m and 10m implied-probability changes into one momentum number.
 *
 * `change1m` is deliberately ignored: single-snapshot moves are dominated by
 * noise, and the volatility damping already accounts for choppiness. Returns
 * null when there is no context or the market is too young to have lookbacks.
 */
function measureMomentum(context?: MarketContext): MomentumReading | null {
  if (!context) {
    return null;
  }
  const changes = [context.trajectory.change5m, context.trajectory.change10m].filter(
    (change): change is number => change !== null,
  );
  if (changes.length === 0) {
    return null;
  }
  return {
    momentum: changes.reduce((sum, change) => sum + change, 0) / changes.length,
    volatility: context.trajectory.volatility,
  };
}

/**
 * Map signed momentum onto a 0..1 confirmation score, where 0.5 means "flat".
 * High volatility shrinks the score back toward 0.5: movement that could just
 * as easily be noise should not add (or remove) much conviction.
 */
function scoreMomentum(directionalMomentum: number, volatility: number | null): number {
  const raw = clamp01(0.5 + directionalMomentum / (2 * MOMENTUM_SATURATION));
  if (volatility === null) {
    return raw;
  }
  const steadiness = clamp01(1 - volatility / VOLATILITY_CEILING);
  return 0.5 + (raw - 0.5) * steadiness;
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

/** Format a probability change as "X.X points" for reasoning strings. */
function formatPoints(value: number): string {
  return `${(value * 100).toFixed(1)} points`;
}
