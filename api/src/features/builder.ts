import type {
  MarketLabelDoc,
  MarketSnapshotDoc,
  OrderbookSnapshotDoc,
  TradeDoc,
} from '../collector/types.js';
import { deriveOrderbookFeatures } from './orderbook.js';
import { derivePriceFeatures } from './price.js';
import { deriveTradeFlowFeatures } from './trades.js';
import type { FeatureRow } from './types.js';

/** Default trade lookback window for flow features (5 minutes). */
const DEFAULT_TRADE_WINDOW_MS = 5 * 60_000;

/**
 * Most recent orderbook at or before `targetMs` from a series sorted
 * oldest → newest.
 *
 * "At or before" is the whole point: pairing a snapshot with a book captured
 * even seconds later would leak the future into the past. The Phase 4 backtest
 * reuses this for the same reason.
 */
export function asOfOrderbook(
  books: OrderbookSnapshotDoc[],
  targetMs: number,
): OrderbookSnapshotDoc | null {
  let found: OrderbookSnapshotDoc | null = null;
  for (const book of books) {
    const t = book.capturedAt.getTime();
    if (t > targetMs) {
      break;
    }
    found = book;
  }
  return found;
}

/**
 * Build feature rows for one market by joining each snapshot with the
 * nearest prior orderbook and the trades in the preceding window.
 *
 * All input arrays should already be filtered to this marketId.
 * Snapshots and books should be sorted oldest → newest.
 */
export function buildFeatureRows(input: {
  snapshots: MarketSnapshotDoc[];
  orderbooks: OrderbookSnapshotDoc[];
  trades: TradeDoc[];
  label?: MarketLabelDoc | null;
  tradeWindowMs?: number;
}): FeatureRow[] {
  const {
    snapshots,
    orderbooks,
    trades,
    label = null,
    tradeWindowMs = DEFAULT_TRADE_WINDOW_MS,
  } = input;

  const result = label?.result ?? null;
  const rows: FeatureRow[] = [];

  for (const snap of snapshots) {
    const atMs = snap.capturedAt.getTime();
    const book = asOfOrderbook(orderbooks, atMs);

    rows.push({
      marketId: snap.marketId,
      title: snap.title,
      status: snap.status,
      capturedAt: snap.capturedAt.toISOString(),
      buyYesPriceUsd: snap.buyYesPriceUsd,
      buyNoPriceUsd: snap.buyNoPriceUsd,
      sellYesPriceUsd: snap.sellYesPriceUsd,
      sellNoPriceUsd: snap.sellNoPriceUsd,
      volumeUsd: snap.volumeUsd,
      openTime: snap.openTime ?? null,
      closeTime: snap.closeTime,
      price: derivePriceFeatures(snapshots, snap),
      orderbook: book ? deriveOrderbookFeatures(book) : null,
      trades: deriveTradeFlowFeatures(trades, atMs, tradeWindowMs),
      result,
    });
  }

  return rows;
}
