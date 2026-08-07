import type { OrderbookSnapshotDoc } from '../collector/types.js';
import type { DepthLevel, OrderbookFeatures } from './types.js';

/** Highest bid price on one side of a dollar-denominated book. */
export function bestBid(levels: Array<[string, number]>): number | null {
  let best = Number.NaN;
  for (const [priceStr] of levels) {
    const price = Number.parseFloat(priceStr);
    if (Number.isFinite(price) && (Number.isNaN(best) || price > best)) {
      best = price;
    }
  }
  return Number.isFinite(best) ? best : null;
}

/** Total resting quantity on one side. */
export function totalQuantity(levels: Array<[string, number]>): number {
  return levels.reduce((sum, level) => sum + (level[1] ?? 0), 0);
}

/**
 * Binary-market microstructure from a stored orderbook.
 *
 * Both sides are bids. Buying NO at p ≈ selling YES at 1 − p, so:
 *   impliedYesAsk = 1 − bestNoBid
 *   mid           = (bestYesBid + impliedYesAsk) / 2
 *   spread        = 1 − bestNoBid − bestYesBid
 */
export function deriveOrderbookFeatures(
  book: Pick<OrderbookSnapshotDoc, 'yesDollars' | 'noDollars'>,
): OrderbookFeatures {
  const yesDollars = book.yesDollars ?? [];
  const noDollars = book.noDollars ?? [];
  const bestYesBid = bestBid(yesDollars);
  const bestNoBid = bestBid(noDollars);
  const yesDepthQty = totalQuantity(yesDollars);
  const noDepthQty = totalQuantity(noDollars);
  const totalDepth = yesDepthQty + noDepthQty;

  const impliedYesAsk =
    bestNoBid !== null ? clamp01(1 - bestNoBid) : null;
  const mid =
    bestYesBid !== null && impliedYesAsk !== null
      ? (bestYesBid + impliedYesAsk) / 2
      : null;
  const spread =
    bestYesBid !== null && bestNoBid !== null
      ? 1 - bestNoBid - bestYesBid
      : null;

  return {
    bestYesBid,
    bestNoBid,
    impliedYesAsk,
    mid,
    spread,
    yesDepthQty,
    noDepthQty,
    totalDepth,
    yesLevels: yesDollars.length,
    noLevels: noDollars.length,
    depthImbalance: totalDepth > 0 ? (yesDepthQty - noDepthQty) / totalDepth : 0,
  };
}

/** Convert dollar levels into a UI-friendly ladder sorted high→low. */
export function toDepthLadder(levels: Array<[string, number]>): DepthLevel[] {
  return levels
    .map(([priceStr, quantity]) => ({
      priceUsd: Number.parseFloat(priceStr),
      quantity,
    }))
    .filter((level) => Number.isFinite(level.priceUsd))
    .sort((a, b) => b.priceUsd - a.priceUsd);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
