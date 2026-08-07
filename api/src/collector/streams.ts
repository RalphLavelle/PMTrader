import { createHash } from 'node:crypto';
import { toUsdPrice } from '../agents/market-analyst/logic.js';
import { jupiter } from '../jupiter/index.js';
import type { JupiterEvent, JupiterMarketSummary, JupiterTrade } from '../jupiter/types.js';
import { labelMarketFromJupiter } from '../labeller/market-labels.js';
import {
  effectiveCategories,
  getTrackedMarketIds,
  isCategoryFilterActive,
  matchesCategory,
  setTrackedMarketIds,
} from './category-filter.js';
import { defaultWideSweepOptions, loadSchedule, saveSchedule } from './schedule.js';
import {
  hashOrderbook,
  insertMarketSnapshots,
  insertOrderbookIfChanged,
  upsertTrades,
} from './store.js';
import type {
  CollectorScheduleFile,
  MarketSnapshotDoc,
  StreamFetchResult,
  TradeDoc,
  WideSweepOptions,
} from './types.js';

/**
 * Newest trade timestamp from the previous /trades poll.
 * Used by the gap detector described in docs/research-dataset.md.
 */
let previousNewestTradeMs: number | null = null;

/**
 * Last written price/volume fingerprint per market — skips unchanged quotes
 * without a Mongo round-trip on every row of a multi-thousand-market sweep.
 */
const lastPriceHashByMarket = new Map<string, string>();

/** Stable hash of the fields that matter for "did this quote move?". */
function priceFingerprint(doc: MarketSnapshotDoc): string {
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
      }),
    )
    .digest('hex');
}

/**
 * Wide price sweep: paginated /events?includeMarkets=true → market_snapshots.
 *
 * Each page is fetched independently so a transient Jupiter 500 on page N still
 * keeps the rows from pages 0..N-1. Only markets whose price/volume hash changed
 * since the last successful write are inserted.
 */
export async function fetchWideSweep(
  schedule: CollectorScheduleFile,
): Promise<StreamFetchResult> {
  const options: WideSweepOptions =
    schedule.streams.wideSweep.options ?? defaultWideSweepOptions();
  const categories = effectiveCategories(options);
  const watchlist = new Set(schedule.marketIds);
  const capturedAt = new Date();
  const docs: MarketSnapshotDoc[] = [];
  let start = 0;
  let pagesOk = 0;
  let pagesFailed = 0;
  let lastPageError: string | null = null;

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
            ...snapshotsFromEvent(event, capturedAt, options, watchlist, categories),
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
          `[collector:wideSweep] Page start=${start} end=${end}${category ? ` category=${category}` : ''} failed: ${lastPageError}`,
        );
        start = end;
      }
    }
  }

  // Keep only markets whose quote actually moved since we last wrote them.
  const changed: MarketSnapshotDoc[] = [];
  let unchanged = 0;
  for (const doc of docs) {
    const hash = priceFingerprint(doc);
    if (lastPriceHashByMarket.get(doc.marketId) === hash) {
      unchanged += 1;
      continue;
    }
    lastPriceHashByMarket.set(doc.marketId, hash);
    changed.push(doc);
  }

  if (pagesOk === 0) {
    return {
      stream: 'wideSweep',
      ok: false,
      message: `Wide sweep failed — all ${pagesFailed} page(s) errored. Last: ${lastPageError ?? 'unknown'}`,
      rowsWritten: 0,
    };
  }

  const rowsWritten = await insertMarketSnapshots(changed);

  // Remember which markets belong to the active filter (for the trades stream).
  if (categories.length > 0) {
    setTrackedMarketIds(docs.map((doc) => doc.marketId));
    await maybeRefreshWatchlist(schedule, docs, options, categories);
  }

  const categoryNote =
    categories.length > 0 ? ` categories=${categories.join(',')}` : '';
  const partial = pagesFailed > 0 ? ` (${pagesFailed} page(s) failed)` : '';
  return {
    stream: 'wideSweep',
    ok: true,
    message: `Wrote ${rowsWritten} changed of ${docs.length} quote(s); ${unchanged} unchanged; ${pagesOk} page(s) ok${categoryNote}${partial}`,
    rowsWritten,
  };
}

/**
 * Replace the orderbook/labels watchlist with the liveliest open markets.
 *
 * Picks by volume so short-horizon crypto markets ("BTC up in the next hour")
 * with real flow get depth capture without hand-editing market ids every day.
 */
async function maybeRefreshWatchlist(
  schedule: CollectorScheduleFile,
  docs: MarketSnapshotDoc[],
  options: WideSweepOptions,
  categories: string[],
): Promise<void> {
  const size = options.autoWatchlistSize;
  if (size <= 0) {
    return;
  }

  const topIds = docs
    .filter((doc) => doc.status === 'open')
    .filter((doc) => matchesCategory(doc.category, categories))
    .sort((left, right) => right.volumeUsd - left.volumeUsd)
    .slice(0, size)
    .map((doc) => doc.marketId);

  if (topIds.length === 0) {
    return;
  }

  const latest = await loadSchedule();
  latest.marketIds = topIds;
  await saveSchedule(latest);
  console.log(
    `[collector:wideSweep] Auto watchlist → ${topIds.length} market(s): ${topIds.join(', ')}`,
  );
}

function snapshotsFromEvent(
  event: JupiterEvent,
  capturedAt: Date,
  options: WideSweepOptions,
  watchlist: Set<string>,
  categories: string[],
): MarketSnapshotDoc[] {
  if (!matchesCategory(event.category, categories)) {
    return [];
  }

  const markets = event.markets ?? [];
  const rows: MarketSnapshotDoc[] = [];
  for (const market of markets) {
    if (options.openMarketsOnly && market.status !== 'open') {
      continue;
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
  return {
    capturedAt,
    marketId: market.marketId,
    eventId: market.eventId ?? event.eventId,
    category: event.category,
    title: market.title,
    status: market.status,
    result: market.result,
    buyYesPriceUsd: toUsdPrice(pricing?.buyYesPriceUsd),
    buyNoPriceUsd: toUsdPrice(pricing?.buyNoPriceUsd),
    sellYesPriceUsd: toUsdPrice(pricing?.sellYesPriceUsd),
    sellNoPriceUsd: toUsdPrice(pricing?.sellNoPriceUsd),
    volumeUsd: Math.max(0, pricing?.volume ?? 0),
    closeTime: market.closeTime ?? null,
  };
}

/** Deep orderbook: GET /orderbook/{id} for each configured marketId. */
export async function fetchOrderbooks(
  schedule: CollectorScheduleFile,
): Promise<StreamFetchResult> {
  const marketIds = schedule.marketIds;
  if (marketIds.length === 0) {
    return {
      stream: 'orderbook',
      ok: true,
      message: 'No marketIds in collector-schedule.json — skipped orderbook fetch',
      rowsWritten: 0,
    };
  }

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
    stream: 'orderbook',
    ok: true,
    message: `Orderbooks: ${written} written, ${unchanged} unchanged (${marketIds.length} market(s))`,
    rowsWritten: written,
  };
}

/** Global trade feed: GET /trades with gap detection + upsert by id. */
export async function fetchTrades(
  schedule: CollectorScheduleFile,
): Promise<StreamFetchResult> {
  const options = schedule.streams.wideSweep.options ?? defaultWideSweepOptions();
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
 * the handful of ids in collector-schedule.json every few minutes, because those
 * are the markets being captured in depth. The labeller
 * (`api/src/labeller/`) covers everything else the wide sweep collected, at a
 * slower cadence. Both share `labelMarketFromJupiter`, so "settled" means the
 * same thing either way.
 */
export async function fetchLabels(schedule: CollectorScheduleFile): Promise<StreamFetchResult> {
  const marketIds = schedule.marketIds;
  if (marketIds.length === 0) {
    return {
      stream: 'labels',
      ok: true,
      message: 'No marketIds in collector-schedule.json — skipped label fetch',
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
    stream: 'labels',
    ok: true,
    message: `Labels: ${labelled} market(s) updated of ${marketIds.length} watched`,
    rowsWritten: labelled,
  };
}
