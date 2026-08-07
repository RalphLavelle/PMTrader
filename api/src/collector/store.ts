import { createHash } from 'node:crypto';
import type { Collection } from 'mongodb';
import { config } from '../config.js';
import { connectMongo, getDatabase } from '../memory/mongodb.client.js';
import {
  effectiveCategories,
  setTrackedMarketIds,
} from './category-filter.js';
import { loadSchedule } from './schedule.js';
import type {
  MarketLabelDoc,
  MarketSnapshotDoc,
  OrderbookSnapshotDoc,
  TradeDoc,
} from './types.js';

/** Ensure Mongo is connected and collector indexes exist. */
export async function initCollectorStore(): Promise<void> {
  await connectMongo();

  await getMarketSnapshots().createIndex({ marketId: 1, capturedAt: -1 });
  await getMarketSnapshots().createIndex({ capturedAt: -1 });
  await getMarketSnapshots().createIndex({ category: 1, capturedAt: -1 });

  await getOrderbookSnapshots().createIndex({ marketId: 1, capturedAt: -1 });
  await getOrderbookSnapshots().createIndex({ marketId: 1, contentHash: 1 });

  await getTrades().createIndex({ id: 1 }, { unique: true });
  await getTrades().createIndex({ marketId: 1, timestamp: -1 });
  await getTrades().createIndex({ timestamp: -1 });

  await getMarketLabels().createIndex({ marketId: 1 }, { unique: true });
  await getMarketLabels().createIndex({ labelledAt: -1 });

  const schedule = await loadSchedule();
  const categories = effectiveCategories(schedule.streams.wideSweep.options);
  await reloadTrackedMarketIds(categories);
}

/** Reload in-memory trade filter ids from snapshots already stored. */
export async function reloadTrackedMarketIds(categories: string[]): Promise<void> {
  if (categories.length === 0) {
    setTrackedMarketIds([]);
    return;
  }

  const ids = await getMarketSnapshots().distinct('marketId', {
    category: { $in: categories },
  });
  setTrackedMarketIds(ids.map(String));
}

export function getMarketSnapshots(): Collection<MarketSnapshotDoc> {
  return getDatabase().collection(config.mongodbMarketSnapshotsCollection);
}

export function getOrderbookSnapshots(): Collection<OrderbookSnapshotDoc> {
  return getDatabase().collection(config.mongodbOrderbookSnapshotsCollection);
}

export function getTrades(): Collection<TradeDoc> {
  return getDatabase().collection(config.mongodbTradesCollection);
}

export function getMarketLabels(): Collection<MarketLabelDoc> {
  return getDatabase().collection(config.mongodbMarketLabelsCollection);
}

/** Stable hash of orderbook levels — used to skip unchanged books. */
export function hashOrderbook(
  yesDollars: Array<[string, number]>,
  noDollars: Array<[string, number]>,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ yesDollars, noDollars }))
    .digest('hex');
}

/** Insert many market price rows from a wide sweep. */
export async function insertMarketSnapshots(docs: MarketSnapshotDoc[]): Promise<number> {
  if (docs.length === 0) {
    return 0;
  }
  const result = await getMarketSnapshots().insertMany(docs, { ordered: false });
  return result.insertedCount;
}

/**
 * Insert an orderbook snapshot only when the content hash changed since the
 * last stored row for this market. Returns true when a row was written.
 */
export async function insertOrderbookIfChanged(doc: OrderbookSnapshotDoc): Promise<boolean> {
  const previous = await getOrderbookSnapshots().findOne(
    { marketId: doc.marketId },
    { sort: { capturedAt: -1 }, projection: { contentHash: 1 } },
  );
  if (previous?.contentHash === doc.contentHash) {
    return false;
  }
  await getOrderbookSnapshots().insertOne(doc);
  return true;
}

/** Upsert trades by Jupiter id so re-polling the feed is idempotent. */
export async function upsertTrades(docs: TradeDoc[]): Promise<number> {
  if (docs.length === 0) {
    return 0;
  }
  let written = 0;
  for (const doc of docs) {
    const result = await getTrades().updateOne(
      { id: doc.id },
      { $setOnInsert: doc },
      { upsert: true },
    );
    if (result.upsertedCount > 0) {
      written += 1;
    }
  }
  return written;
}

/** Upsert a resolution label keyed by marketId. */
export async function upsertMarketLabel(doc: MarketLabelDoc): Promise<boolean> {
  const result = await getMarketLabels().updateOne(
    { marketId: doc.marketId },
    { $set: doc },
    { upsert: true },
  );
  return result.upsertedCount > 0 || result.modifiedCount > 0;
}
