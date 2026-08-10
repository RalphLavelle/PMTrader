import type { MarketSnapshotDoc, OrderbookSnapshotDoc, TradeDoc } from '../collector/types.js';
import { asOfOrderbook } from '../features/builder.js';
import { buildMarketContextAt, type MarketContext } from '../features/context.js';
import { reconstructSnapshot } from '../features/reconstruct.js';
import type { MarketSnapshot } from '../schemas/index.js';

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

/** Re-export so existing backtest imports keep working. */
export { reconstructSnapshot } from '../features/reconstruct.js';

/** One moment in a market's history that the strategy will be asked about. */
export interface DecisionPoint {
  snapshot: MarketSnapshot;
  hadOrderbook: boolean;
  /** Canonical as-of-T context shared with the live swarm path. */
  context: MarketContext;
  /**
   * Raw as-of orderbook ladders when a book existed at T.
   * Used by the paper fill model for depth / partial fills — never for look-ahead.
   */
  orderbook: OrderbookSnapshotDoc | null;
}

/**
 * Thin a market's snapshot series down to evenly spaced decision points.
 *
 * Without thinning, a market polled every 30 seconds for a day contributes
 * ~2,880 near-identical decisions. Those are not 2,880 independent tests of the
 * strategy — they are one opinion repeated — and averaging over them would make
 * a fragile result look statistically solid.
 *
 * All input arrays must be sorted oldest → newest. Each point's context is
 * built only from observations at or before that point's timestamp.
 */
export function buildDecisionPoints(
  snapshots: MarketSnapshotDoc[],
  orderbooks: OrderbookSnapshotDoc[],
  intervalMinutes: number,
  trades: TradeDoc[] = [],
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
    const snapshot = reconstructSnapshot(snap, book);
    const context = buildMarketContextAt({
      at: snap.capturedAt,
      snapshots,
      orderbooks,
      trades,
      liveSnapshot: snapshot,
      openTime: snap.openTime ?? null,
    });

    points.push({
      snapshot: context.snapshot,
      hadOrderbook: context.meta.hadOrderbook,
      context,
      orderbook: book,
    });
  }

  return points;
}
