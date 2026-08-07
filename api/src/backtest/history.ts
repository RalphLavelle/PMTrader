import { summariseDepth, toUsdPrice } from '../agents/market-analyst/logic.js';
import type { MarketSnapshotDoc, OrderbookSnapshotDoc } from '../collector/types.js';
import { asOfOrderbook } from '../features/builder.js';
import { marketSnapshotSchema, type MarketSnapshot } from '../schemas/index.js';

/**
 * Turning stored collector rows back into the snapshot the agents expect.
 *
 * The collector writes two separate documents — a price row and an orderbook
 * row — while every agent takes a single `MarketSnapshot`. This module rejoins
 * them, and it is where look-ahead bias would creep in if we were careless.
 *
 * Look-ahead bias means letting a decision see information that did not exist
 * yet. It is the single easiest way to produce a backtest that looks brilliant
 * and loses money live, so the rule here is absolute: a decision at time T may
 * only use rows captured at or before T.
 */

/** An empty book, used when the collector never captured depth for a market. */
const NO_DEPTH = { levels: 0, totalQuantity: 0, bestPriceUsd: null };

/**
 * Rebuild the agent-facing snapshot from one price row and its as-of book.
 *
 * Two fields are unavoidably absent. The collector does not store resolution
 * rules, so `rulesPrimary` / `rulesSecondary` are null — which is the honest
 * reason the semantic agent sits out the replay entirely: it reads prose that
 * was never collected.
 */
export function reconstructSnapshot(
  snap: MarketSnapshotDoc,
  book: OrderbookSnapshotDoc | null,
): MarketSnapshot {
  return marketSnapshotSchema.parse({
    marketId: snap.marketId,
    title: snap.title,
    status: snap.status,
    // Collector rows are already 0..1 USD; toUsdPrice is a no-op on those and
    // guards the odd corrupt value, so both paths normalise identically.
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

/** One moment in a market's history that the strategy will be asked about. */
export interface DecisionPoint {
  snapshot: MarketSnapshot;
  hadOrderbook: boolean;
}

/**
 * Thin a market's snapshot series down to evenly spaced decision points.
 *
 * Without thinning, a market polled every 30 seconds for a day contributes
 * ~2,880 near-identical decisions. Those are not 2,880 independent tests of the
 * strategy — they are one opinion repeated — and averaging over them would make
 * a fragile result look statistically solid.
 *
 * Both input arrays must be sorted oldest → newest.
 */
export function buildDecisionPoints(
  snapshots: MarketSnapshotDoc[],
  orderbooks: OrderbookSnapshotDoc[],
  intervalMinutes: number,
): DecisionPoint[] {
  const intervalMs = Math.max(1, intervalMinutes) * 60_000;
  const points: DecisionPoint[] = [];
  let lastTakenMs = Number.NEGATIVE_INFINITY;

  for (const snap of snapshots) {
    const atMs = snap.capturedAt.getTime();
    if (atMs - lastTakenMs < intervalMs) {
      continue;
    }
    lastTakenMs = atMs;

    const book = asOfOrderbook(orderbooks, atMs);
    points.push({
      snapshot: reconstructSnapshot(snap, book),
      hadOrderbook: book !== null,
    });
  }

  return points;
}
