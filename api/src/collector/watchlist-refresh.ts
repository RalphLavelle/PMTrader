import { matchesCategory } from './category-filter.js';
import { config } from '../config.js';
import { loadWatchlistFile, saveWatchlist } from '../shared/watchlist.js';
import type { MarketSnapshotDoc, MarketSnapshotsOptions } from './types.js';
import {
  WATCHLIST_POLICY,
  compareCandidates,
  eventKey,
  hoursUntilClose,
  isExtremeYes,
  isLongHorizon,
  isPreferredHorizon,
  passesQuote,
  pickBestPerEvent,
  type WatchlistSnapshot,
} from './watchlist-score.js';

export { WATCHLIST_POLICY, hoursUntilClose } from './watchlist-score.js';
export type { WatchlistSnapshot } from './watchlist-score.js';

export interface WatchlistRefreshInput {
  currentIds: string[];
  strikes: Record<string, number>;
  docs: WatchlistSnapshot[];
  size: number;
  categories: string[];
  now: Date;
  maxQuoteSum: number;
}

export interface WatchlistRefreshResult {
  marketIds: string[];
  strikes: Record<string, number>;
  skipWrite: boolean;
}

/**
 * Pure watchlist chooser — sticky until close, then fill with gated, diverse,
 * nearer-term markets. Soft-evicts open duds only after several failing sweeps.
 */
export function selectWatchlist(input: WatchlistRefreshInput): WatchlistRefreshResult {
  const { currentIds, size, categories, now, maxQuoteSum } = input;
  if (size <= 0) {
    return { marketIds: currentIds, strikes: input.strikes, skipWrite: true };
  }

  const byId = new Map(input.docs.map((doc) => [doc.marketId, doc]));
  const closed = new Set<string>();
  for (const doc of input.docs) {
    const hours = hoursUntilClose(doc.closeTime, now);
    if (doc.status !== 'open' || (hours !== null && hours <= 0)) {
      closed.add(doc.marketId);
    }
  }

  // Missing from this sweep = vanished (closed without a status row, or
  // dropped from Jupiter's catalog). Do not keep as "unobserved sticky" —
  // that left four expired VIP seats filming silence. Lifecycle follow-up
  // re-fetches watchlist ids first; if they are still open they re-enter docs.
  const sticky = currentIds.filter((id) => !closed.has(id) && byId.has(id));
  const strikes: Record<string, number> = { ...input.strikes };
  // Clear strikes for ids we just dropped as vanished/closed.
  for (const id of currentIds) {
    if (!sticky.includes(id)) {
      delete strikes[id];
    }
  }
  const openPool = input.docs.filter(
    (doc) =>
      doc.status === 'open' &&
      !closed.has(doc.marketId) &&
      matchesCategory(doc.category, categories),
  );

  const isAdoptable = (doc: WatchlistSnapshot): boolean =>
    passesQuote(doc, maxQuoteSum) && !isExtremeYes(doc);

  const preferredWaiting = openPool.filter((doc) => {
    if (sticky.includes(doc.marketId)) {
      return false;
    }
    return isAdoptable(doc) && isPreferredHorizon(hoursUntilClose(doc.closeTime, now));
  });
  const anyGatedFiller = openPool.some(
    (doc) => !sticky.includes(doc.marketId) && isAdoptable(doc),
  );

  const observedSticky = sticky
    .map((id) => byId.get(id))
    .filter((doc): doc is WatchlistSnapshot => Boolean(doc));
  const diversityKeep = new Set(
    pickBestPerEvent(observedSticky, now, WATCHLIST_POLICY.maxPerEventTitle),
  );

  const longHorizonObserved = observedSticky.filter((doc) =>
    isLongHorizon(hoursUntilClose(doc.closeTime, now)),
  );
  const deepKeep = new Set(
    longHorizonObserved
      .filter((doc) => passesQuote(doc, maxQuoteSum) && !isExtremeYes(doc))
      .sort((left, right) => right.volumeUsd - left.volumeUsd)
      .slice(0, WATCHLIST_POLICY.deepLongHorizonSlots)
      .map((doc) => doc.marketId),
  );

  // Priority 0 = worst (evict first). Only observed sticky are scored.
  const strikeWhy = new Map<string, number>();
  for (const id of sticky) {
    const doc = byId.get(id);
    if (!doc) {
      continue;
    }
    let why: number | null = null;
    if (!passesQuote(doc, maxQuoteSum)) {
      why = 0;
    } else if (isExtremeYes(doc)) {
      why = 1;
    } else if (!diversityKeep.has(id) && anyGatedFiller) {
      why = 2;
    } else if (
      isLongHorizon(hoursUntilClose(doc.closeTime, now)) &&
      !deepKeep.has(id) &&
      preferredWaiting.length > 0
    ) {
      why = 3;
    }
    if (why !== null) {
      strikes[id] = (strikes[id] ?? 0) + 1;
      strikeWhy.set(id, why);
    } else {
      delete strikes[id];
    }
  }

  const evicted = new Set<string>();
  const evictable = sticky
    .filter((id) => (strikes[id] ?? 0) >= WATCHLIST_POLICY.softEvictStrikes)
    .sort((left, right) => {
      const whyDiff = (strikeWhy.get(left) ?? 9) - (strikeWhy.get(right) ?? 9);
      if (whyDiff !== 0) {
        return whyDiff;
      }
      return (byId.get(left)?.volumeUsd ?? 0) - (byId.get(right)?.volumeUsd ?? 0);
    });
  for (const id of evictable) {
    if (evicted.size >= WATCHLIST_POLICY.maxSoftEvictPerSweep) {
      break;
    }
    const remaining = sticky.filter((stickyId) => stickyId !== id && !evicted.has(stickyId));
    const fillerCount = openPool.filter(
      (doc) =>
        !remaining.includes(doc.marketId) &&
        doc.marketId !== id &&
        !evicted.has(doc.marketId) &&
        isAdoptable(doc),
    ).length;
    if (remaining.length + fillerCount === 0) {
      continue;
    }
    evicted.add(id);
    delete strikes[id];
  }

  const kept = sticky.filter((id) => !evicted.has(id)).slice(0, size);
  const selected = [...kept];
  const eventCounts = new Map<string, number>();
  for (const id of selected) {
    const key = eventKey(byId.get(id), id);
    eventCounts.set(key, (eventCounts.get(key) ?? 0) + 1);
  }

  const longHorizonCount = () =>
    selected.filter((id) => isLongHorizon(hoursUntilClose(byId.get(id)?.closeTime ?? null, now))).length;

  const fillers = openPool
    .filter((doc) => {
      if (selected.includes(doc.marketId) || evicted.has(doc.marketId)) {
        return false;
      }
      return isAdoptable(doc);
    })
    .sort((left, right) => compareCandidates(left, right, now));
  for (const doc of fillers) {
    if (selected.length >= size) {
      break;
    }
    const key = eventKey(doc, doc.marketId);
    if ((eventCounts.get(key) ?? 0) >= WATCHLIST_POLICY.maxPerEventTitle) {
      continue;
    }
    if (
      isLongHorizon(hoursUntilClose(doc.closeTime, now)) &&
      longHorizonCount() >= WATCHLIST_POLICY.deepLongHorizonSlots
    ) {
      continue;
    }
    selected.push(doc.marketId);
    eventCounts.set(key, (eventCounts.get(key) ?? 0) + 1);
    delete strikes[doc.marketId];
  }

  if (selected.length === 0) {
    return { marketIds: [], strikes: {}, skipWrite: true };
  }

  const nextStrikes: Record<string, number> = {};
  for (const id of selected) {
    if ((strikes[id] ?? 0) > 0) {
      nextStrikes[id] = strikes[id]!;
    }
  }
  return { marketIds: selected, strikes: nextStrikes, skipWrite: false };
}

/**
 * After a price sweep, rewrite the shared watchlist using the learning-oriented
 * chooser. No-op when autoWatchlistSize is 0 (manual list).
 */
export async function maybeRefreshWatchlist(
  docs: MarketSnapshotDoc[],
  options: MarketSnapshotsOptions,
  categories: string[],
): Promise<void> {
  const size = options.autoWatchlistSize;
  if (size <= 0) {
    return;
  }

  const current = await loadWatchlistFile();
  const result = selectWatchlist({
    currentIds: current.marketIds,
    strikes: current.strikes ?? {},
    docs,
    size,
    categories,
    now: new Date(),
    maxQuoteSum: config.paperMaxEntryQuoteSum,
  });
  if (result.skipWrite) {
    return;
  }

  await saveWatchlist(result.marketIds, result.strikes);
  const preview = result.marketIds.join(', ');
  console.log(
    `[collector:market_snapshots] Auto watchlist → ${result.marketIds.length} market(s) (sticky until close, gated fill): ${preview}`,
  );
}
