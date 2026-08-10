import { getEventsCatalogCollection, type StoredEventsCatalogDocument } from '../memory/mongodb.client.js';
import type { JupiterEvent } from './types.js';
import type { AnyBulkWriteOperation } from 'mongodb';

const META_DOC_ID = 'meta';
const BULK_WRITE_BATCH = 500;

export interface StoredEventsCatalog {
  events: JupiterEvent[];
  fetchedAt: number;
}

/** Load the last successful catalog snapshot from MongoDB. */
export async function loadStoredCatalog(): Promise<StoredEventsCatalog | null> {
  const collection = getEventsCatalogCollection();
  const meta = await collection.findOne({ id: META_DOC_ID });
  if (!meta) {
    return null;
  }

  const documents = await collection.find({ id: { $ne: META_DOC_ID } }).toArray();
  if (documents.length === 0) {
    return null;
  }

  return {
    events: documents.map((document) => document.event as JupiterEvent),
    fetchedAt: meta.fetchedAt,
  };
}

/**
 * Replace the stored catalog with a fresh Jupiter snapshot.
 *
 * Each event is stored as its own document so the snapshot stays under MongoDB's
 * 16 MB per-document limit. A small meta row records the fetch timestamp.
 */
export async function saveStoredCatalog(
  events: JupiterEvent[],
  fetchedAt: number,
): Promise<void> {
  const collection = getEventsCatalogCollection();
  const eventIds = events.map((event) => event.eventId);

  const operations: AnyBulkWriteOperation<StoredEventsCatalogDocument>[] = events.map(
    (event) => ({
      replaceOne: {
        filter: { id: event.eventId },
        replacement: { id: event.eventId, event, fetchedAt },
        upsert: true,
      },
    }),
  );

  operations.push({
    replaceOne: {
      filter: { id: META_DOC_ID },
      replacement: { id: META_DOC_ID, fetchedAt, eventCount: events.length },
      upsert: true,
    },
  });

  for (let index = 0; index < operations.length; index += BULK_WRITE_BATCH) {
    await collection.bulkWrite(operations.slice(index, index + BULK_WRITE_BATCH));
  }

  // Remove stale events and any legacy single-blob snapshot (`id: "current"`).
  await collection.deleteMany({
    id: { $nin: [...eventIds, META_DOC_ID] },
  });
}
