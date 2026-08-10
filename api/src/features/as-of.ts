import type {
  MarketSnapshotDoc,
  OrderbookSnapshotDoc,
  TradeDoc,
} from '../collector/types.js';

/**
 * Look-ahead guards shared by the research Feature Builder and MarketContext.
 *
 * Look-ahead bias means letting a decision at time T use information that only
 * existed after T. These helpers keep every join on the "at or before T" side
 * of the timeline so live analysis and offline replay see the same world.
 */

/** Keep rows whose `capturedAt` is at or before `atMs` (series may be unsorted). */
export function snapshotsAtOrBefore(
  snapshots: MarketSnapshotDoc[],
  atMs: number,
): MarketSnapshotDoc[] {
  return snapshots
    .filter((snap) => snap.capturedAt.getTime() <= atMs)
    .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
}

/** Keep orderbook rows captured at or before `atMs`. */
export function orderbooksAtOrBefore(
  orderbooks: OrderbookSnapshotDoc[],
  atMs: number,
): OrderbookSnapshotDoc[] {
  return orderbooks
    .filter((book) => book.capturedAt.getTime() <= atMs)
    .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
}

/** Keep trades whose fill timestamp is at or before `atMs`. */
export function tradesAtOrBefore(trades: TradeDoc[], atMs: number): TradeDoc[] {
  return trades
    .filter((trade) => trade.timestamp.getTime() <= atMs)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}
