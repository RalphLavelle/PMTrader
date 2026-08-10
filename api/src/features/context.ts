import { deriveFeatures } from '../agents/market-analyst/logic.js';
import type {
  MarketSnapshotDoc,
  OrderbookSnapshotDoc,
  TradeDoc,
} from '../collector/types.js';
import type { DerivedFeatures, MarketSnapshot } from '../schemas/index.js';
import {
  orderbooksAtOrBefore,
  snapshotsAtOrBefore,
  tradesAtOrBefore,
} from './as-of.js';
import { asOfOrderbook } from './builder.js';
import { deriveOrderbookFeatures } from './orderbook.js';
import { derivePriceFeatures } from './price.js';
import { reconstructSnapshot } from './reconstruct.js';
import { deriveTradeFlowFeatures } from './trades.js';
import type { OrderbookFeatures, PriceFeatures, TradeFlowFeatures } from './types.js';

/** Default trade-flow window ending at decision time T (5 minutes). */
const DEFAULT_TRADE_WINDOW_MS = 5 * 60_000;

/**
 * Canonical market view available to PMTrader at decision time T.
 *
 * This is the single object live analysis and offline replay should share.
 * It contains only information that would genuinely have been observable at
 * or before T — never future prices, books, trades, volume, or resolution.
 *
 * Intentionally omits `result` / labels. Resolution is useful *after* a trade
 * for scoring; including it here would leak the answer key into the decision.
 */
export interface MarketContext {
  /** Decision instant T as an ISO timestamp. */
  at: string;
  /** Normalised market state agents already consume. */
  snapshot: MarketSnapshot;
  /** Point-in-time derived features (existing agent contract). */
  features: DerivedFeatures;
  /**
   * Research time-series features as of T.
   * Built from collector history (and the live tip when analysing now).
   */
  trajectory: PriceFeatures;
  /** Microstructure from the latest orderbook at or before T, if any. */
  orderbook: OrderbookFeatures | null;
  /** Trade-flow summary over the lookback window ending at T. */
  tradeFlow: TradeFlowFeatures;
  /** Market metadata known at T. */
  meta: {
    marketId: string;
    title: string;
    status: string;
    openTime: number | null;
    closeTime: number | null;
    /** True when an orderbook observation existed at or before T. */
    hadOrderbook: boolean;
    /** Number of price observations ≤ T used to build trajectory. */
    historyPoints: number;
  };
}

/** Inputs for building a context strictly as-of T. */
export interface BuildMarketContextInput {
  /** Decision time T. */
  at: Date;
  /** Price archive (may include rows after T — they are stripped). */
  snapshots: MarketSnapshotDoc[];
  /** Orderbook archive (may include rows after T — they are stripped). */
  orderbooks: OrderbookSnapshotDoc[];
  /** Trade archive (may include fills after T — they are stripped). */
  trades: TradeDoc[];
  /**
   * Optional live tip from Jupiter. When set, becomes the current snapshot
   * and is appended to the history series (still at T, never after).
   */
  liveSnapshot?: MarketSnapshot;
  /** Open time from Jupiter when the live tip does not carry it. */
  openTime?: number | null;
  /** Resolution rules for the live semantic path (null in replay). */
  rulesPrimary?: string | null;
  rulesSecondary?: string | null;
  tradeWindowMs?: number;
}

/**
 * Build the canonical MarketContext available at time T.
 *
 * Future rows in the input arrays are ignored. Resolution labels are never
 * attached. Callers that already hold a reconstructed live/replay snapshot
 * should pass it as `liveSnapshot` so agents keep receiving the same
 * `MarketSnapshot` / `DerivedFeatures` shapes they use today.
 */
export function buildMarketContextAt(input: BuildMarketContextInput): MarketContext {
  const atMs = input.at.getTime();
  const tradeWindowMs = input.tradeWindowMs ?? DEFAULT_TRADE_WINDOW_MS;

  // Strip anything after T first — this is the hard look-ahead boundary.
  let history = snapshotsAtOrBefore(input.snapshots, atMs);
  const books = orderbooksAtOrBefore(input.orderbooks, atMs);
  const trades = tradesAtOrBefore(input.trades, atMs);

  const openTime =
    input.openTime ??
    history[history.length - 1]?.openTime ??
    null;

  let snapshot: MarketSnapshot;
  if (input.liveSnapshot) {
    snapshot = {
      ...input.liveSnapshot,
      // Prefer explicit rules from the live fetch when provided.
      rulesPrimary: input.rulesPrimary ?? input.liveSnapshot.rulesPrimary,
      rulesSecondary: input.rulesSecondary ?? input.liveSnapshot.rulesSecondary,
      capturedAt: input.at.toISOString(),
    };
    history = mergeLiveTip(history, snapshotToHistoryDoc(snapshot, openTime));
  } else {
    const tip = history[history.length - 1];
    if (!tip) {
      throw new Error('Cannot build MarketContext without snapshots at or before T.');
    }
    const book = asOfOrderbook(books, atMs);
    snapshot = reconstructSnapshot(tip, book);
    if (input.rulesPrimary !== undefined) {
      snapshot = { ...snapshot, rulesPrimary: input.rulesPrimary };
    }
    if (input.rulesSecondary !== undefined) {
      snapshot = { ...snapshot, rulesSecondary: input.rulesSecondary };
    }
  }

  const tipDoc = history[history.length - 1];
  if (!tipDoc) {
    throw new Error('Cannot build MarketContext without a tip observation at T.');
  }

  const book = asOfOrderbook(books, atMs);
  const features = deriveFeatures(snapshot, input.at);
  const trajectory = derivePriceFeatures(history, tipDoc);
  const orderbook = book ? deriveOrderbookFeatures(book) : null;
  const tradeFlow = deriveTradeFlowFeatures(trades, atMs, tradeWindowMs);

  return {
    at: input.at.toISOString(),
    snapshot,
    features,
    trajectory,
    orderbook,
    tradeFlow,
    meta: {
      marketId: snapshot.marketId,
      title: snapshot.title,
      status: snapshot.status,
      openTime,
      closeTime: snapshot.closeTime,
      hadOrderbook: book !== null,
      historyPoints: history.length,
    },
  };
}

/**
 * Turn an agent-facing snapshot into a history row so trajectory maths can
 * include the live tip. `result` is always null here — resolution must never
 * enter the decision-time context.
 */
export function snapshotToHistoryDoc(
  snapshot: MarketSnapshot,
  openTime: number | null = null,
): MarketSnapshotDoc {
  return {
    capturedAt: new Date(snapshot.capturedAt),
    marketId: snapshot.marketId,
    title: snapshot.title,
    status: snapshot.status,
    result: null,
    buyYesPriceUsd: snapshot.buyYesPriceUsd,
    buyNoPriceUsd: snapshot.buyNoPriceUsd,
    sellYesPriceUsd: snapshot.sellYesPriceUsd,
    sellNoPriceUsd: snapshot.sellNoPriceUsd,
    volumeUsd: snapshot.volumeUsd,
    openTime,
    closeTime: snapshot.closeTime,
    contentHash: 'live-tip',
  };
}

/** Append or replace the tip so the series ends exactly at the live observation. */
function mergeLiveTip(
  history: MarketSnapshotDoc[],
  tip: MarketSnapshotDoc,
): MarketSnapshotDoc[] {
  const tipMs = tip.capturedAt.getTime();
  const withoutFutureOrSameTip = history.filter((snap) => {
    const t = snap.capturedAt.getTime();
    return t < tipMs;
  });
  return [...withoutFutureOrSameTip, tip];
}
