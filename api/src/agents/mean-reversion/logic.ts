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
 * Mean Reversion Agent business logic — pure, deterministic, no LangGraph or LLM.
 *
 * Mean reversion is the opposite bet to trend following: it fades a crowded
 * market on the assumption the price has overshot. Two guards keep that from
 * becoming reckless:
 *
 * 1. A market must be meaningfully stretched before there is anything to fade.
 * 2. Reversion needs *time*. A market pinned at 97% an hour before close is
 *    usually right, not mispriced, so confidence decays as close approaches.
 */

/** Below this extremity the market is not stretched enough to fade. */
const MIN_EXTREMITY_FOR_REVERSION = 0.3;

/** Hours of runway at which the reversion window is considered fully open. */
const FULL_REVERSION_WINDOW_HOURS = 72;

/** Weights for the confidence components; they sum to 1. */
const WEIGHT_EXTREMITY = 0.55;
const WEIGHT_WINDOW = 0.3;
const WEIGHT_LIQUIDITY = 0.15;

/**
 * Evaluate a reversal opportunity.
 *
 * Like the trend agent, this returns a neutral zero-confidence signal when no
 * edge is present so the Risk Manager can distinguish "looked, found nothing"
 * from "did not run".
 */
export function evaluateMeanReversion(
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
  const reversionWindow = calculateReversionWindow(features.hoursToClose);

  const supportingMetrics = {
    impliedYesProbability: features.impliedYesProbability,
    priceExtremity: features.priceExtremity,
    reversionWindow,
    liquidityScore: features.liquidityScore,
  };

  if (features.priceExtremity < MIN_EXTREMITY_FOR_REVERSION) {
    return agentSignalSchema.parse({
      agent: AGENT_NAMES.meanReversion,
      stance: 'neutral' satisfies Stance,
      confidence: 0,
      reasoning:
        `Market "${snapshot.title}" sits at an implied ` +
        `${formatPercent(features.impliedYesProbability)}, which is not stretched ` +
        'far enough from even money to justify fading.',
      supportingMetrics,
      generatedAt,
    });
  }

  // Fade the crowd: if the market is leaning yes, the reversion bet is no.
  const crowdFavoursYes = features.impliedYesProbability >= 0.5;
  const stance: Stance = crowdFavoursYes ? 'no' : 'yes';

  const confidence = clamp01(
    WEIGHT_EXTREMITY * features.priceExtremity +
      WEIGHT_WINDOW * reversionWindow +
      WEIGHT_LIQUIDITY * features.liquidityScore,
  );

  return agentSignalSchema.parse({
    agent: AGENT_NAMES.meanReversion,
    stance,
    confidence,
    reasoning:
      `Market is stretched to an implied ${formatPercent(features.impliedYesProbability)} ` +
      `(extremity ${features.priceExtremity.toFixed(2)}), so the reversion bet is ` +
      `${stance.toUpperCase()}. ${describeWindow(features.hoursToClose, reversionWindow)}`,
    supportingMetrics,
    generatedAt,
  });
}

/**
 * How much room the market still has to revert, scored 0..1.
 *
 * An unknown close time is treated as a fully open window: absence of a
 * deadline is not evidence of an imminent one.
 */
function calculateReversionWindow(hoursToClose: number | null): number {
  if (hoursToClose === null) {
    return 1;
  }
  return clamp01(hoursToClose / FULL_REVERSION_WINDOW_HOURS);
}

function describeWindow(hoursToClose: number | null, reversionWindow: number): string {
  if (hoursToClose === null) {
    return 'No close time published, so the reversion window is treated as open.';
  }
  return (
    `About ${hoursToClose.toFixed(1)}h remain before close, giving a reversion ` +
    `window score of ${reversionWindow.toFixed(2)}.`
  );
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
