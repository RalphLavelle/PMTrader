import type { JupiterMarketDetail, JupiterOrderbook } from '../../jupiter/types.js';
import {
  derivedFeaturesSchema,
  marketSnapshotSchema,
  type DerivedFeatures,
  type MarketSnapshot,
  type OrderbookDepth,
} from '../../schemas/index.js';

/**
 * Market Analyst business logic — pure functions, no LangGraph and no LLM.
 *
 * Everything here is deterministic and synchronous, which makes it directly
 * unit-testable: give it a Jupiter payload, assert on the numbers that come out.
 */

/** Depth at which a market is considered fully liquid for scoring purposes. */
const LIQUIDITY_REFERENCE_QUANTITY = 1_000;

/** A spread this wide (in USD) scores zero on the spread component of liquidity. */
const MAX_ACCEPTABLE_SPREAD_USD = 0.1;

/** Collapse one side of the orderbook into the summary statistics agents use. */
function summariseDepth(levels: Array<[string, number]>): OrderbookDepth {
  const totalQuantity = levels.reduce((sum, level) => sum + (level[1] ?? 0), 0);
  const bestLevel = levels[0];
  const bestPrice = bestLevel ? Number.parseFloat(bestLevel[0]) : Number.NaN;

  return {
    levels: levels.length,
    totalQuantity,
    bestPriceUsd: Number.isFinite(bestPrice) ? bestPrice : null,
  };
}

/** Clamp a value into the inclusive 0..1 range expected by the schemas. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * Convert raw Jupiter responses into the normalised snapshot agents consume.
 *
 * Doing this conversion once, at the edge, means a change to the Jupiter API
 * shape only ever affects this function rather than all five agents.
 */
export function buildMarketSnapshot(
  market: JupiterMarketDetail,
  orderbook: JupiterOrderbook,
  capturedAt: Date = new Date(),
): MarketSnapshot {
  const pricing = market.pricing;

  return marketSnapshotSchema.parse({
    marketId: market.marketId,
    title: market.title,
    status: market.status,
    // A missing price means Jupiter has not quoted the market yet; 0.5 is the
    // only neutral assumption available and keeps downstream maths well defined.
    buyYesPriceUsd: clamp01(pricing?.buyYesPriceUsd ?? 0.5),
    buyNoPriceUsd: clamp01(pricing?.buyNoPriceUsd ?? 0.5),
    sellYesPriceUsd: clamp01(pricing?.sellYesPriceUsd ?? 0.5),
    sellNoPriceUsd: clamp01(pricing?.sellNoPriceUsd ?? 0.5),
    volumeUsd: Math.max(0, pricing?.volume ?? 0),
    yesDepth: summariseDepth(orderbook.yes_dollars),
    noDepth: summariseDepth(orderbook.no_dollars),
    rulesPrimary: market.rulesPrimary ?? null,
    rulesSecondary: market.rulesSecondary ?? null,
    closeTime: market.closeTime ?? null,
    capturedAt: capturedAt.toISOString(),
  });
}

/**
 * Compute the quantitative features every strategy agent reasons over.
 *
 * The Market Analyst owns this step so that trend and mean-reversion agents
 * compare like with like instead of each deriving their own numbers.
 */
export function deriveFeatures(
  snapshot: MarketSnapshot,
  now: Date = new Date(),
): DerivedFeatures {
  const priceTotal = snapshot.buyYesPriceUsd + snapshot.buyNoPriceUsd;

  // Normalising against the yes+no total removes the market's built-in spread,
  // leaving the probability the two prices actually imply.
  const impliedYesProbability = priceTotal > 0 ? snapshot.buyYesPriceUsd / priceTotal : 0.5;

  const spreadUsd = Math.abs(snapshot.buyYesPriceUsd - snapshot.sellYesPriceUsd);

  const yesQuantity = snapshot.yesDepth.totalQuantity;
  const noQuantity = snapshot.noDepth.totalQuantity;
  const totalDepth = yesQuantity + noQuantity;
  const depthImbalance = totalDepth > 0 ? (yesQuantity - noQuantity) / totalDepth : 0;

  // A saturating curve avoids an arbitrary cut-off: depth equal to the reference
  // scores 0.5, and the score approaches 1 as depth grows without ever exceeding it.
  const depthComponent = totalDepth / (totalDepth + LIQUIDITY_REFERENCE_QUANTITY);
  const spreadComponent = 1 - Math.min(spreadUsd / MAX_ACCEPTABLE_SPREAD_USD, 1);
  const liquidityScore = clamp01(0.7 * depthComponent + 0.3 * spreadComponent);

  return derivedFeaturesSchema.parse({
    impliedYesProbability: clamp01(impliedYesProbability),
    spreadUsd,
    depthImbalance: Math.min(1, Math.max(-1, depthImbalance)),
    totalDepth,
    liquidityScore,
    // Doubling maps the 0..0.5 distance from an even market onto a full 0..1 scale.
    priceExtremity: clamp01(Math.abs(impliedYesProbability - 0.5) * 2),
    hoursToClose: calculateHoursToClose(snapshot.closeTime, now),
  });
}

/** Hours until the market closes, or null when Jupiter did not supply a close time. */
function calculateHoursToClose(closeTime: number | null, now: Date): number | null {
  if (closeTime === null || closeTime <= 0) {
    return null;
  }

  const millisecondsRemaining = closeTime * 1000 - now.getTime();
  return Math.max(0, millisecondsRemaining / 3_600_000);
}
