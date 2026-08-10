import { jupiter } from './index.js';
import { loadStoredCatalog, saveStoredCatalog } from './catalog-store.js';
import type { JupiterEvent } from './types.js';

/** Jupiter event categories used to sweep the full catalog without duplicates. */
export const JUPITER_CATEGORIES = [
  'crypto',
  'sports',
  'politics',
  'esports',
  'culture',
  'economics',
  'tech',
] as const;

const PAGE_SIZE = 100;
const MAX_PAGES_PER_CATEGORY = 200;
/** How long a snapshot is considered fresh before a background refresh starts. */
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedEvents: JupiterEvent[] | null = null;
let cachedAt = 0;
let fetchPromise: Promise<{ events: JupiterEvent[]; fetchedAt: number }> | null = null;

export interface EventsCatalogResponse {
  data: JupiterEvent[];
  fetchedAt: string;
  eventCount: number;
  marketCount: number;
  /** True when the response came from memory or MongoDB rather than a live Jupiter sweep. */
  fromCache: boolean;
  /** True when a Jupiter refresh is running and clients may poll for an updated snapshot. */
  refreshing: boolean;
}

/** Paginate one Jupiter category until hasNext is false (or safety cap). */
async function fetchCategoryEvents(category: string): Promise<JupiterEvent[]> {
  const events: JupiterEvent[] = [];
  let start = 0;

  for (let page = 0; page < MAX_PAGES_PER_CATEGORY; page += 1) {
    const end = start + PAGE_SIZE;
    const response = await jupiter.getEvents({
      category,
      includeMarkets: 'true',
      start: String(start),
      end: String(end),
    });

    events.push(...response.data);

    if (!response.pagination?.hasNext || response.data.length === 0) {
      break;
    }
    start = response.pagination.end ?? end;
  }

  return events;
}

/** Fetch every category and dedupe by eventId. */
async function fetchAllEvents(): Promise<JupiterEvent[]> {
  const byId = new Map<string, JupiterEvent>();

  for (const category of JUPITER_CATEGORIES) {
    const events = await fetchCategoryEvents(category);
    for (const event of events) {
      byId.set(event.eventId, event);
    }
  }

  return Array.from(byId.values());
}

function buildResponse(
  events: JupiterEvent[],
  fromCache: boolean,
  fetchedAt: number,
  refreshing: boolean,
): EventsCatalogResponse {
  let marketCount = 0;
  for (const event of events) {
    marketCount += event.markets?.length ?? 0;
  }

  return {
    data: events,
    fetchedAt: new Date(fetchedAt).toISOString(),
    eventCount: events.length,
    marketCount,
    fromCache,
    refreshing,
  };
}

function applyMemoryCache(events: JupiterEvent[], fetchedAt: number): void {
  cachedEvents = events;
  cachedAt = fetchedAt;
}

async function fetchAndPersist(): Promise<{ events: JupiterEvent[]; fetchedAt: number }> {
  if (!fetchPromise) {
    fetchPromise = fetchAllEvents()
      .then(async (events) => {
        const fetchedAt = Date.now();
        applyMemoryCache(events, fetchedAt);
        try {
          await saveStoredCatalog(events, fetchedAt);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[catalog] Failed to persist snapshot: ${message}`);
        }
        return { events, fetchedAt };
      })
      .finally(() => {
        fetchPromise = null;
      });
  }

  return fetchPromise;
}

/** Kick off a Jupiter refresh without blocking the caller. */
function startBackgroundRefresh(): void {
  if (fetchPromise) {
    return;
  }

  void fetchAndPersist().catch((error) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[catalog] Background refresh failed: ${message}`);
  });
}

/**
 * Full Jupiter events catalog with nested markets.
 *
 * Returns a MongoDB snapshot immediately when one exists, then refreshes from
 * Jupiter in the background. The first request with no snapshot still waits for
 * Jupiter because there is nothing to show yet.
 */
export async function getEventsCatalog(options?: {
  refresh?: boolean;
}): Promise<EventsCatalogResponse> {
  const now = Date.now();
  const forceRefresh = options?.refresh === true;

  if (!forceRefresh && cachedEvents && now - cachedAt < CACHE_TTL_MS) {
    return buildResponse(cachedEvents, true, cachedAt, Boolean(fetchPromise));
  }

  const stored = await loadStoredCatalog();
  const stale = !stored || now - stored.fetchedAt > CACHE_TTL_MS;

  if (stored) {
    applyMemoryCache(stored.events, stored.fetchedAt);

    if (forceRefresh || stale) {
      startBackgroundRefresh();
    }

    return buildResponse(
      stored.events,
      true,
      stored.fetchedAt,
      forceRefresh || stale || Boolean(fetchPromise),
    );
  }

  const { events, fetchedAt } = await fetchAndPersist();
  return buildResponse(events, false, fetchedAt, false);
}
