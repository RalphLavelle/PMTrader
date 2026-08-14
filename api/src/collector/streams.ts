import { toUsdPrice } from '../agents/market-analyst/logic.js';
import { jupiter } from '../jupiter/index.js';
import type {
  JupiterEvent,
  JupiterMarketDetail,
  JupiterMarketSummary,
  JupiterTrade,
} from '../jupiter/types.js';
import { labelMarketFromJupiter } from '../labeller/market-labels.js';
import {
  effectiveCategories,
  getTrackedMarketIds,
  isCategoryFilterActive,
  matchesCategory,
  setTrackedMarketIds,
} from './category-filter.js';
import { loadWatchlist } from '../shared/watchlist.js';
import { defaultMarketSnapshotsOptions } from './schedule.js';
import { maybeRefreshWatchlist } from './watchlist-refresh.js';
import {
  hashMarketSnapshot,
  hashOrderbook,
  insertMarketSnapshotsIfChanged,
  insertOrderbookIfChanged,
  listOpenTrackedMarketIds,
  loadLatestSnapshotHashes,
  upsertTrades,
} from './store.js';
import type {
  CollectorScheduleFile,
  MarketSnapshotDoc,
  StreamFetchResult,
  TradeDoc,
  MarketSnapshotsOptions,
} from './types.js';

/**
 * Newest trade timestamp from the previous /trades poll.
 * Used by the gap detector described in docs/ResearchDataset.md.
 */
let previousNewestTradeMs: number | null = null;

/**
 * Last written contentHash per market — avoids a Mongo round-trip on every
 * row of a multi-hundred-market sweep. Seeded from Mongo on the first sweep
 * after process start so restarts do not re-insert identical quotes.
 */
const lastPriceHashByMarket = new Map<string, string>();
let priceHashCacheReady = false;

/** Warm the in-memory hash cache from the latest stored snapshot per market. */
async function ensurePriceHashCache(): Promise<void> {
  if (priceHashCacheReady) {
    return;
  }
  const fromDb = await loadLatestSnapshotHashes();
  for (const [marketId, hash] of fromDb) {
    if (!lastPriceHashByMarket.has(marketId)) {
      lastPriceHashByMarket.set(marketId, hash);
    }
  }
  priceHashCacheReady = true;
}

/**
 * market_snapshots price sweep: paginated /events?includeMarkets=true → market_snapshots.
 *
 * Each page is fetched independently so a transient Jupiter 500 on page N still
 * keeps the rows from pages 0..N-1. Only markets whose price/volume hash changed
 * since the last successful write are inserted.
 *
 * After the /events pages, a small lifecycle follow-up batch re-checks markets
 * that were still open in our archive but missing from this sweep — so we keep
 * observing them through close even when pagination or ranking drops them.
 */
export async function fetchMarketSnapshots(
  schedule: CollectorScheduleFile,
): Promise<StreamFetchResult> {
  const options: MarketSnapshotsOptions =
    schedule.streams.market_snapshots.options ?? defaultMarketSnapshotsOptions();
  const categories = effectiveCategories(options);
  const watchedIds = await loadWatchlist();
  const watchlist = new Set(watchedIds);
  // Observation time for this sweep — set once before any network work so every
  // row from the same poll shares one replay clock, not Mongo write time.
  const capturedAt = new Date();
  const docs: MarketSnapshotDoc[] = [];
  let start = 0;
  let pagesOk = 0;
  let pagesFailed = 0;
  let lastPageError: string | null = null;

  await ensurePriceHashCache();

  // Markets we have already archived (or are watching) may receive a final
  // non-open observation even when openMarketsOnly is true.
  const alreadyTracked = new Set<string>([
    ...getTrackedMarketIds(),
    ...lastPriceHashByMarket.keys(),
    ...watchedIds,
  ]);

  // One pass per category (or a single unfiltered pass when categories is empty).
  const categoryPasses = categories.length > 0 ? categories : [undefined as string | undefined];

  for (const category of categoryPasses) {
    start = 0;
    for (let page = 0; page < options.maxPages; page += 1) {
      const end = start + options.pageSize;
      try {
        const query: Record<string, string> = {
          includeMarkets: 'true',
          start: String(start),
          end: String(end),
        };
        if (category) {
          query.category = category;
        }

        const response = await jupiter.getEvents(query);

        for (const event of response.data) {
          docs.push(
            ...snapshotsFromEvent(
              event,
              capturedAt,
              options,
              watchlist,
              categories,
              alreadyTracked,
            ),
          );
        }
        pagesOk += 1;

        if (!response.pagination?.hasNext || response.data.length === 0) {
          break;
        }
        start = response.pagination.end ?? end;
      } catch (error) {
        pagesFailed += 1;
        lastPageError = error instanceof Error ? error.message : 'Unknown error';
        console.warn(
          `[collector:market_snapshots] Page start=${start} end=${end}${category ? ` category=${category}` : ''} failed: ${lastPageError}`,
        );
        start = end;
      }
    }
  }

  // Chase markets that fell off /events pages while still open in our archive.
  const seenIds = new Set(docs.map((doc) => doc.marketId));
  const followUp = await fetchLifecycleFollowUps(
    options,
    categories,
    seenIds,
    capturedAt,
  );
  docs.push(...followUp.docs);

  if (pagesOk === 0 && followUp.docs.length === 0) {
    return {
      stream: 'market_snapshots',
      ok: false,
      message: `market_snapshots sweep failed — all ${pagesFailed} page(s) errored. Last: ${lastPageError ?? 'unknown'}`,
      rowsWritten: 0,
    };
  }

  const { written: rowsWritten, unchanged } = await insertMarketSnapshotsIfChanged(
    docs,
    lastPriceHashByMarket,
  );

  // Union tracked ids so trades keep filtering correctly after pagination drops.
  // Only needed when a category filter is active — unfiltered mode stores every fill.
  if (categories.length > 0) {
    const merged = new Set<string>([
      ...getTrackedMarketIds(),
      ...docs.map((doc) => doc.marketId),
    ]);
    setTrackedMarketIds(merged);
  }
  // The orderbook/labels watchlist must keep rotating in every mode, or depth
  // capture would stay pinned to whatever markets were watched at switch time.
  await maybeRefreshWatchlist(docs, options, categories);

  const categoryNote =
    categories.length > 0 ? ` categories=${categories.join(',')}` : '';
  const partial = pagesFailed > 0 ? ` (${pagesFailed} page(s) failed)` : '';
  const followNote =
    followUp.checked > 0
      ? `; lifecycle follow-up ${followUp.docs.length}/${followUp.checked}`
      : '';
  return {
    stream: 'market_snapshots',
    ok: true,
    message: `Wrote ${rowsWritten} changed of ${docs.length} quote(s); ${unchanged} unchanged; ${pagesOk} page(s) ok${categoryNote}${partial}${followNote}`,
    rowsWritten,
  };
}

/**
 * Re-check markets missing from this /events sweep via GET /markets/{id}.
 *
 * Jupiter has no history API and /events is paginated, so a market can vanish
 * from the first N pages while still trading (or just as it closes). A small
 * batch of detail fetches closes that gap without WebSockets.
 *
 * Watchlist ids missing from the sweep are always prioritised — otherwise the
 * chooser would drop them as "vanished" even when they are still open.
 */
async function fetchLifecycleFollowUps(
  options: MarketSnapshotsOptions,
  categories: string[],
  seenIds: Set<string>,
  capturedAt: Date,
): Promise<{ docs: MarketSnapshotDoc[]; checked: number }> {
  const batch = options.lifecycleFollowUpBatch;
  if (batch <= 0) {
    return { docs: [], checked: 0 };
  }

  const [openIds, watchlistIds] = await Promise.all([
    listOpenTrackedMarketIds(categories, 500),
    loadWatchlist(),
  ]);

  // Watchlist corpses first, then other open tracked markets that fell off pages.
  const missingWatch = watchlistIds.filter((id) => !seenIds.has(id));
  const missingTracked = openIds.filter(
    (id) => !seenIds.has(id) && !missingWatch.includes(id),
  );
  const missing = [...missingWatch, ...missingTracked].slice(0, batch);
  if (missing.length === 0) {
    return { docs: [], checked: 0 };
  }

  const docs: MarketSnapshotDoc[] = [];
  for (const marketId of missing) {
    try {
      const market = await jupiter.getMarket(marketId);
      docs.push(snapshotFromMarketDetail(market, capturedAt, categories));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(
        `[collector:market_snapshots] Lifecycle follow-up failed for ${marketId}: ${message}`,
      );
    }
  }

  return { docs, checked: missing.length };
}

function snapshotsFromEvent(
  event: JupiterEvent,
  capturedAt: Date,
  options: MarketSnapshotsOptions,
  watchlist: Set<string>,
  categories: string[],
  alreadyTracked: Set<string>,
): MarketSnapshotDoc[] {
  if (!matchesCategory(event.category, categories)) {
    return [];
  }

  const markets = event.markets ?? [];
  const rows: MarketSnapshotDoc[] = [];
  for (const market of markets) {
    if (options.openMarketsOnly && market.status !== 'open') {
      // Still record the close/resolution transition for markets we already know.
      if (!alreadyTracked.has(market.marketId)) {
        continue;
      }
    }
    if (options.watchlistOnly && !watchlist.has(market.marketId)) {
      continue;
    }
    rows.push(snapshotFromMarket(market, event, capturedAt));
  }
  return rows;
}

function snapshotFromMarket(
  market: JupiterMarketSummary,
  event: JupiterEvent,
  capturedAt: Date,
): MarketSnapshotDoc {
  const pricing = market.pricing;
  const base = {
    capturedAt,
    marketId: market.marketId,
    eventId: market.eventId ?? event.eventId,
    eventTitle: event.metadata.title,
    category: event.category,
    title: market.title,
    status: market.status,
    result: market.result,
    buyYesPriceUsd: toUsdPrice(pricing?.buyYesPriceUsd),
    buyNoPriceUsd: toUsdPrice(pricing?.buyNoPriceUsd),
    sellYesPriceUsd: toUsdPrice(pricing?.sellYesPriceUsd),
    sellNoPriceUsd: toUsdPrice(pricing?.sellNoPriceUsd),
    volumeUsd: Math.max(0, pricing?.volume ?? 0),
    openTime: normaliseUnixSeconds(market.openTime),
    closeTime: normaliseUnixSeconds(market.closeTime),
  };
  return {
    ...base,
    contentHash: hashMarketSnapshot(base),
  };
}

/** Same shape as wide-sweep rows, built from GET /markets/{id} detail. */
function snapshotFromMarketDetail(
  market: JupiterMarketDetail,
  capturedAt: Date,
  categories: string[],
): MarketSnapshotDoc {
  const pricing = market.pricing;
  // Detail responses do not always echo event.category — keep the filter tag
  // when we know we are in a single-category mode.
  const category = categories.length === 1 ? categories[0] : undefined;
  const base = {
    capturedAt,
    marketId: market.marketId,
    eventId: market.eventId,
    category,
    title: market.title,
    status: market.status,
    result: market.result,
    buyYesPriceUsd: toUsdPrice(pricing?.buyYesPriceUsd),
    buyNoPriceUsd: toUsdPrice(pricing?.buyNoPriceUsd),
    sellYesPriceUsd: toUsdPrice(pricing?.sellYesPriceUsd),
    sellNoPriceUsd: toUsdPrice(pricing?.sellNoPriceUsd),
    volumeUsd: Math.max(0, pricing?.volume ?? 0),
    openTime: normaliseUnixSeconds(market.openTime),
    closeTime: normaliseUnixSeconds(market.closeTime),
  };
  return {
    ...base,
    contentHash: hashMarketSnapshot(base),
  };
}

/** Jupiter times are unix seconds; treat 0 / missing as unknown. */
function normaliseUnixSeconds(value: number | undefined | null): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return Math.trunc(n);
}

/** Deep orderbook: GET /orderbook/{id} for each shared watchlist marketId. */
export async function fetchOrderbookSnapshots(
  _schedule: CollectorScheduleFile,
): Promise<StreamFetchResult> {
  const marketIds = await loadWatchlist();
  if (marketIds.length === 0) {
    return {
      stream: 'orderbook_snapshots',
      ok: true,
      message: 'No marketIds in shared/watchlist.json — skipped orderbook_snapshots fetch',
      rowsWritten: 0,
    };
  }

  // Shared observation time for this orderbook poll pass.
  const capturedAt = new Date();
  let written = 0;
  let unchanged = 0;

  for (const marketId of marketIds) {
    const book = await jupiter.getOrderbook(marketId);
    const yesDollars = book.yes_dollars ?? [];
    const noDollars = book.no_dollars ?? [];
    const contentHash = hashOrderbook(yesDollars, noDollars);
    const didWrite = await insertOrderbookIfChanged({
      capturedAt,
      marketId,
      yesDollars,
      noDollars,
      contentHash,
    });
    if (didWrite) {
      written += 1;
    } else {
      unchanged += 1;
    }
  }

  return {
    stream: 'orderbook_snapshots',
    ok: true,
    message: `Orderbooks: ${written} written, ${unchanged} unchanged (${marketIds.length} market(s))`,
    rowsWritten: written,
  };
}

/** Global trade feed: GET /trades with gap detection + upsert by id. */
export async function fetchTrades(
  schedule: CollectorScheduleFile,
): Promise<StreamFetchResult> {
  const options = schedule.streams.market_snapshots.options ?? defaultMarketSnapshotsOptions();
  const categoryFilter = isCategoryFilterActive(options);
  const tracked = getTrackedMarketIds();

  const response = await jupiter.getTrades();
  let trades = response.data ?? [];

  // Jupiter returns every market's fills — drop rows outside the active filter.
  if (categoryFilter) {
    if (tracked.size === 0) {
      return {
        stream: 'trades',
        ok: true,
        message: 'Trades: skipped — category filter active but no markets tracked yet (run wide sweep first)',
        rowsWritten: 0,
      };
    }
    trades = trades.filter((trade) => tracked.has(trade.marketId));
  }

  // Gap detector: if the oldest new trade is newer than our previous newest,
  // fills were missed between polls.
  if (trades.length > 0 && previousNewestTradeMs !== null) {
    const oldestInBatch = Math.min(...trades.map((t) => tradeTimestampMs(t)));
    if (oldestInBatch > previousNewestTradeMs) {
      console.warn(
        `[collector:trades] Possible gap — oldest new trade ${new Date(oldestInBatch).toISOString()} is after previous newest ${new Date(previousNewestTradeMs).toISOString()}`,
      );
    }
  }

  if (trades.length > 0) {
    previousNewestTradeMs = Math.max(...trades.map((t) => tradeTimestampMs(t)));
  }

  const docs: TradeDoc[] = trades.map(toTradeDoc);
  const rowsWritten = await upsertTrades(docs);

  return {
    stream: 'trades',
    ok: true,
    message: `Trades: ${rowsWritten} new of ${docs.length} seen`,
    rowsWritten,
  };
}

function tradeTimestampMs(trade: JupiterTrade): number {
  // Jupiter timestamps may be seconds or milliseconds — normalise to ms.
  const raw = Number(trade.timestamp);
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return raw < 1_000_000_000_000 ? raw * 1_000 : raw;
}

function toTradeDoc(trade: JupiterTrade): TradeDoc {
  return {
    id: String(trade.id),
    timestamp: new Date(tradeTimestampMs(trade)),
    marketId: trade.marketId,
    ownerPubkey: trade.ownerPubkey,
    action: trade.action,
    side: trade.side,
    amountUsd: trade.amountUsd,
    priceUsd: trade.priceUsd,
    eventTitle: trade.eventTitle,
    marketTitle: trade.marketTitle,
    eventId: trade.eventId,
  };
}

/**
 * Resolution labels for the watchlist.
 *
 * This stream is the high-frequency slice of the Phase 3 labeller: it re-checks
 * the handful of ids in shared/watchlist.json every few minutes, because those
 * are the markets being captured in depth. The labeller
 * (`api/src/labeller/`) covers everything else market_snapshots collected, at a
 * slower cadence. Both share `labelMarketFromJupiter`, so "settled" means the
 * same thing either way.
 */
export async function fetchMarketLabels(
  _schedule: CollectorScheduleFile,
): Promise<StreamFetchResult> {
  const marketIds = await loadWatchlist();
  if (marketIds.length === 0) {
    return {
      stream: 'market_labels',
      ok: true,
      message: 'No marketIds in shared/watchlist.json — skipped market_labels fetch',
      rowsWritten: 0,
    };
  }

  let labelled = 0;
  for (const marketId of marketIds) {
    if ((await labelMarketFromJupiter(marketId)) === 'labelled') {
      labelled += 1;
    }
  }

  return {
    stream: 'market_labels',
    ok: true,
    message: `Labels: ${labelled} market(s) updated of ${marketIds.length} watched`,
    rowsWritten: labelled,
  };
}
