import type {
  MarketLabelDoc,
  MarketSnapshotDoc,
  OrderbookSnapshotDoc,
  TradeDoc,
} from '../collector/types.js';
import {
  getMarketLabels,
  getMarketSnapshots,
  getOrderbookSnapshots,
  getTrades,
} from '../collector/store.js';
import { config } from '../config.js';
import type { CollectionCoverage, LabelledMarketCoverage, MarketCoverage } from './types.js';

/** Count / time-span / distinct-market stats for one collection. */
async function collectionCoverage(
  collectionName: string,
  timeField: string,
): Promise<CollectionCoverage> {
  const { getDatabase } = await import('../memory/mongodb.client.js');
  const col = getDatabase().collection(collectionName);
  const count = await col.countDocuments();

  if (count === 0) {
    return {
      collection: collectionName,
      count: 0,
      distinctMarkets: 0,
      oldestAt: null,
      newestAt: null,
    };
  }

  const [oldest, newest, marketIds] = await Promise.all([
    col.find({}).sort({ [timeField]: 1 }).limit(1).toArray(),
    col.find({}).sort({ [timeField]: -1 }).limit(1).toArray(),
    col.distinct('marketId'),
  ]);

  return {
    collection: collectionName,
    count,
    distinctMarkets: marketIds.length,
    oldestAt: toIso(oldest[0]?.[timeField]),
    newestAt: toIso(newest[0]?.[timeField]),
  };
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return null;
}

/** Coverage across all collector collections. */
export async function loadCollectionCoverage(): Promise<CollectionCoverage[]> {
  return Promise.all([
    collectionCoverage(config.mongodbMarketSnapshotsCollection, 'capturedAt'),
    collectionCoverage(config.mongodbOrderbookSnapshotsCollection, 'capturedAt'),
    collectionCoverage(config.mongodbTradesCollection, 'timestamp'),
    collectionCoverage(config.mongodbMarketLabelsCollection, 'labelledAt'),
  ]);
}

/**
 * Markets present in market_snapshots, newest first, with row counts and
 * latest quote. Optional case-insensitive search on marketId / title.
 */
export async function listMarketCoverage(options?: {
  search?: string;
  limit?: number;
  category?: string;
}): Promise<MarketCoverage[]> {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 500);
  const search = options?.search?.trim();
  const category = options?.category?.trim().toLowerCase();

  const matchParts: Record<string, unknown>[] = [];
  if (search && search.length > 0) {
    matchParts.push({
      $or: [
        { marketId: { $regex: escapeRegex(search), $options: 'i' } },
        { title: { $regex: escapeRegex(search), $options: 'i' } },
      ],
    });
  }
  if (category) {
    matchParts.push({ category });
  }

  const match =
    matchParts.length === 0
      ? {}
      : matchParts.length === 1
        ? matchParts[0]
        : { $and: matchParts };

  const rows = await getMarketSnapshots()
    .aggregate<{
      _id: string;
      title: string;
      status: string;
      snapshotCount: number;
      latestBuyYesPriceUsd: number;
      latestBuyNoPriceUsd: number;
      lastSeenAt: Date;
      category?: string;
    }>([
      { $match: match },
      { $sort: { capturedAt: -1 } },
      {
        $group: {
          _id: '$marketId',
          title: { $first: '$title' },
          status: { $first: '$status' },
          snapshotCount: { $sum: 1 },
          latestBuyYesPriceUsd: { $first: '$buyYesPriceUsd' },
          latestBuyNoPriceUsd: { $first: '$buyNoPriceUsd' },
          lastSeenAt: { $first: '$capturedAt' },
          category: { $first: '$category' },
        },
      },
      { $sort: { lastSeenAt: -1 } },
      { $limit: limit },
    ])
    .toArray();

  return rows.map((row) => {
    const total = row.latestBuyYesPriceUsd + row.latestBuyNoPriceUsd;
    const latestImpliedYes =
      total > 0 ? row.latestBuyYesPriceUsd / total : 0.5;
    return {
      marketId: row._id,
      title: row.title,
      status: row.status,
      snapshotCount: row.snapshotCount,
      latestBuyYesPriceUsd: row.latestBuyYesPriceUsd,
      latestImpliedYes,
      lastSeenAt: row.lastSeenAt.toISOString(),
      category: row.category,
    };
  });
}

/** Markets that have at least one orderbook snapshot. */
export async function listOrderbookCoverage(limit = 50): Promise<
  Array<{ marketId: string; snapshotCount: number; lastSeenAt: string }>
> {
  const rows = await getOrderbookSnapshots()
    .aggregate<{ _id: string; snapshotCount: number; lastSeenAt: Date }>([
      { $sort: { capturedAt: -1 } },
      {
        $group: {
          _id: '$marketId',
          snapshotCount: { $sum: 1 },
          lastSeenAt: { $first: '$capturedAt' },
        },
      },
      { $sort: { lastSeenAt: -1 } },
      { $limit: Math.min(Math.max(limit, 1), 200) },
    ])
    .toArray();

  return rows.map((row) => ({
    marketId: row._id,
    snapshotCount: row.snapshotCount,
    lastSeenAt: row.lastSeenAt.toISOString(),
  }));
}

export async function countLabels(): Promise<number> {
  return getMarketLabels().countDocuments();
}

/** Count rows per market for one collector collection, keyed by marketId. */
async function countRowsByMarket(
  collection: ReturnType<typeof getMarketSnapshots> | ReturnType<typeof getOrderbookSnapshots>,
  marketIds: string[],
): Promise<Map<string, number>> {
  const rows = await collection
    .aggregate<{ _id: string; count: number }>([
      { $match: { marketId: { $in: marketIds } } },
      { $group: { _id: '$marketId', count: { $sum: 1 } } },
    ])
    .toArray();

  return new Map(rows.map((row) => [row._id, row.count]));
}

/**
 * Markets carrying a decisive yes/no label — the supervised slice of the
 * dataset, and the only part Phase 4 backtesting can actually score against.
 */
export async function listLabelledMarkets(limit = 50): Promise<LabelledMarketCoverage[]> {
  const labels = await getMarketLabels()
    .find({ result: { $in: ['yes', 'no'] } })
    .sort({ labelledAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 500))
    .toArray();

  if (labels.length === 0) {
    return [];
  }

  const marketIds = labels.map((label) => label.marketId);
  const [snapshotCounts, orderbookCounts] = await Promise.all([
    countRowsByMarket(getMarketSnapshots(), marketIds),
    countRowsByMarket(getOrderbookSnapshots(), marketIds),
  ]);

  return labels.map((label) => ({
    marketId: label.marketId,
    title: label.title,
    // Narrowed by the query above; the cast keeps the public type honest.
    result: label.result as 'yes' | 'no',
    status: label.status,
    closeTime: label.closeTime,
    labelledAt: label.labelledAt.toISOString(),
    snapshotCount: snapshotCounts.get(label.marketId) ?? 0,
    orderbookCount: orderbookCounts.get(label.marketId) ?? 0,
  }));
}

/** Load chronological snapshots for one market (oldest → newest). */
export async function loadMarketSnapshots(
  marketId: string,
  limit = 500,
): Promise<MarketSnapshotDoc[]> {
  return getMarketSnapshots()
    .find({ marketId })
    .sort({ capturedAt: 1 })
    .limit(Math.min(Math.max(limit, 1), 2_000))
    .toArray();
}

/** Load chronological orderbooks for one market (oldest → newest). */
export async function loadMarketOrderbooks(
  marketId: string,
  limit = 500,
): Promise<OrderbookSnapshotDoc[]> {
  return getOrderbookSnapshots()
    .find({ marketId })
    .sort({ capturedAt: 1 })
    .limit(Math.min(Math.max(limit, 1), 2_000))
    .toArray();
}

/** Load trades for one market (or all) newest first. */
export async function loadTrades(options?: {
  marketId?: string;
  limit?: number;
  /** When true, return oldest→newest (needed for feature joins). */
  ascending?: boolean;
}): Promise<TradeDoc[]> {
  const filter = options?.marketId ? { marketId: options.marketId } : {};
  const sortDir = options?.ascending ? 1 : -1;
  return getTrades()
    .find(filter)
    .sort({ timestamp: sortDir })
    .limit(Math.min(Math.max(options?.limit ?? 100, 1), 2_000))
    .toArray();
}

export async function loadLabel(marketId: string): Promise<MarketLabelDoc | null> {
  return getMarketLabels().findOne({ marketId });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
