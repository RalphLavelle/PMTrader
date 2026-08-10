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

  // Replay / intramarket queries always key by market then time.
  await getMarketSnapshots().createIndex({ marketId: 1, capturedAt: -1 });
  await getMarketSnapshots().createIndex({ capturedAt: -1 });
  await getMarketSnapshots().createIndex({ category: 1, capturedAt: -1 });
  // Speeds "latest hash for this market" checks used by durable dedupe.
  await getMarketSnapshots().createIndex({ marketId: 1, contentHash: 1 });

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

/**
 * Stable hash of the quote fields that matter for "did this observation move?".
 * Exported so the wide-sweep stream and store stay in sync.
 */
export function hashMarketSnapshot(doc: Pick<
  MarketSnapshotDoc,
  | 'buyYesPriceUsd'
  | 'buyNoPriceUsd'
  | 'sellYesPriceUsd'
  | 'sellNoPriceUsd'
  | 'volumeUsd'
  | 'status'
  | 'result'
  | 'openTime'
  | 'closeTime'
>): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        buyYes: doc.buyYesPriceUsd,
        buyNo: doc.buyNoPriceUsd,
        sellYes: doc.sellYesPriceUsd,
        sellNo: doc.sellNoPriceUsd,
        volume: doc.volumeUsd,
        status: doc.status,
        result: doc.result,
        openTime: doc.openTime,
        closeTime: doc.closeTime,
      }),
    )
    .digest('hex');
}

/**
 * Latest contentHash per marketId — warms the in-memory dedupe cache after
 * restart so an identical poll does not re-insert the same quote.
 */
export async function loadLatestSnapshotHashes(
  marketIds?: string[],
): Promise<Map<string, string>> {
  const match =
    marketIds && marketIds.length > 0
      ? { marketId: { $in: marketIds } }
      : {};

  const rows = await getMarketSnapshots()
    .aggregate<{ _id: string; contentHash: string }>([
      { $match: match },
      { $sort: { capturedAt: -1 } },
      {
        $group: {
          _id: '$marketId',
          contentHash: { $first: '$contentHash' },
        },
      },
    ])
    .toArray();

  const map = new Map<string, string>();
  for (const row of rows) {
    // Older rows written before contentHash existed have undefined — skip them.
    if (typeof row.contentHash === 'string' && row.contentHash.length > 0) {
      map.set(row._id, row.contentHash);
    }
  }
  return map;
}

/**
 * Markets whose latest snapshot is still `open` — used for lifecycle follow-up
 * when /events pagination drops them before they close.
 */
export async function listOpenTrackedMarketIds(
  categories: string[],
  limit = 500,
): Promise<string[]> {
  const match: Record<string, unknown> = {};
  if (categories.length > 0) {
    match.category = { $in: categories };
  }

  const rows = await getMarketSnapshots()
    .aggregate<{ _id: string; status: string }>([
      { $match: match },
      { $sort: { capturedAt: -1 } },
      {
        $group: {
          _id: '$marketId',
          status: { $first: '$status' },
        },
      },
      { $match: { status: 'open' } },
      { $limit: Math.max(1, limit) },
    ])
    .toArray();

  return rows.map((row) => row._id);
}

/**
 * Insert market price rows that actually changed since the last stored
 * observation for that market. Uses `contentHash` so duplicate polls survive
 * process restarts without creating duplicate observations.
 */
export async function insertMarketSnapshotsIfChanged(
  docs: MarketSnapshotDoc[],
  knownHashes: Map<string, string>,
): Promise<{ written: number; unchanged: number }> {
  if (docs.length === 0) {
    return { written: 0, unchanged: 0 };
  }

  const toInsert: MarketSnapshotDoc[] = [];
  let unchanged = 0;

  for (const doc of docs) {
    const hash = doc.contentHash || hashMarketSnapshot(doc);
    const previous = knownHashes.get(doc.marketId);
    if (previous === hash) {
      unchanged += 1;
      continue;
    }
    // Fill contentHash if a caller forgot — keep documents self-describing.
    const row = doc.contentHash ? doc : { ...doc, contentHash: hash };
    toInsert.push(row);
    knownHashes.set(doc.marketId, hash);
  }

  if (toInsert.length === 0) {
    return { written: 0, unchanged };
  }

  const result = await getMarketSnapshots().insertMany(toInsert, { ordered: false });
  return { written: result.insertedCount, unchanged };
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
