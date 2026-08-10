import { summariseDepth, toUsdPrice } from '../agents/market-analyst/logic.js';
import type { MarketSnapshotDoc, OrderbookSnapshotDoc } from '../collector/types.js';
import { marketSnapshotSchema, type MarketSnapshot } from '../schemas/index.js';

/** Empty depth when no as-of orderbook exists at T. */
const NO_DEPTH = { levels: 0, totalQuantity: 0, bestPriceUsd: null };

/**
 * Rebuild the agent-facing snapshot from one price row and its as-of book.
 *
 * Lives in `features/` so MarketContext and the backtest share one converter
 * without `features` importing `backtest` (which would create a cycle).
 *
 * Resolution rules are null unless a caller overlays them — the collector does
 * not store rules, and replay must not invent today's rules for a past market.
 */
export function reconstructSnapshot(
  snap: MarketSnapshotDoc,
  book: OrderbookSnapshotDoc | null,
): MarketSnapshot {
  return marketSnapshotSchema.parse({
    marketId: snap.marketId,
    title: snap.title,
    status: snap.status,
    buyYesPriceUsd: toUsdPrice(snap.buyYesPriceUsd),
    buyNoPriceUsd: toUsdPrice(snap.buyNoPriceUsd),
    sellYesPriceUsd: toUsdPrice(snap.sellYesPriceUsd),
    sellNoPriceUsd: toUsdPrice(snap.sellNoPriceUsd),
    volumeUsd: Math.max(0, snap.volumeUsd),
    yesDepth: book ? summariseDepth(book.yesDollars) : NO_DEPTH,
    noDepth: book ? summariseDepth(book.noDollars) : NO_DEPTH,
    rulesPrimary: null,
    rulesSecondary: null,
    closeTime: snap.closeTime,
    capturedAt: snap.capturedAt.toISOString(),
  });
}
