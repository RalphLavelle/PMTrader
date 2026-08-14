import type { MarketSnapshotDoc } from './types.js';

/**
 * How the collector chooses the short "VIP" watchlist (order books, swarm, paper).
 *
 * Stickiness still wins: we do not drop a market just because volume dipped.
 * Closed markets leave immediately. Open-but-useless markets leave slowly
 * (several sweeps) so we keep a usable depth history while making room for
 * markets that will actually teach the agents.
 */
export const WATCHLIST_POLICY = {
  /** Prefer markets that finish soon enough to label, but not in the next few hours. */
  preferredMinHours: 6,
  preferredMaxHours: 14 * 24,
  /** Beyond this, a market only keeps a "deep" slot (year-end BTC buckets, etc.). */
  longHorizonHours: 30 * 24,
  /** How many long-horizon markets may occupy the list at once. */
  deepLongHorizonSlots: 2,
  /** Max watchlist ids that share the same event question. */
  maxPerEventTitle: 2,
  /** YES prices outside this band are lottery tickets, not skill tests. */
  extremeYesLow: 0.08,
  extremeYesHigh: 0.92,
  /** Consecutive failing sweeps before a sticky id is rotated out. */
  softEvictStrikes: 6,
  /** Cap per sweep so a batch of duds does not empty the camera all at once. */
  maxSoftEvictPerSweep: 2,
} as const;

/** Snapshot fields the chooser needs — tests can pass stubs. */
export type WatchlistSnapshot = Pick<
  MarketSnapshotDoc,
  | 'marketId'
  | 'status'
  | 'category'
  | 'eventTitle'
  | 'volumeUsd'
  | 'buyYesPriceUsd'
  | 'buyNoPriceUsd'
  | 'closeTime'
>;

/** Hours until closeTime (unix seconds), or null when Jupiter did not supply one. */
export function hoursUntilClose(closeTime: number | null, now: Date): number | null {
  if (closeTime === null || closeTime <= 0) {
    return null;
  }
  return (closeTime * 1000 - now.getTime()) / 3_600_000;
}

export function eventKey(doc: WatchlistSnapshot | undefined, fallbackId: string): string {
  const title = doc?.eventTitle?.trim();
  return title && title.length > 0 ? title : fallbackId;
}

export function passesQuote(doc: WatchlistSnapshot, maxQuoteSum: number): boolean {
  return doc.buyYesPriceUsd + doc.buyNoPriceUsd <= maxQuoteSum;
}

export function isExtremeYes(doc: WatchlistSnapshot): boolean {
  return (
    doc.buyYesPriceUsd < WATCHLIST_POLICY.extremeYesLow ||
    doc.buyYesPriceUsd > WATCHLIST_POLICY.extremeYesHigh
  );
}

export function isPreferredHorizon(hours: number | null): boolean {
  return (
    hours !== null &&
    hours >= WATCHLIST_POLICY.preferredMinHours &&
    hours <= WATCHLIST_POLICY.preferredMaxHours
  );
}

export function isLongHorizon(hours: number | null): boolean {
  return hours !== null && hours > WATCHLIST_POLICY.longHorizonHours;
}

/** Lower is better: preferred band, then closing-soon, then mid, then unknown, then far. */
export function horizonRank(hours: number | null): number {
  if (isPreferredHorizon(hours)) {
    return 0;
  }
  if (hours !== null && hours > 0 && hours < WATCHLIST_POLICY.preferredMinHours) {
    return 1;
  }
  if (
    hours !== null &&
    hours > WATCHLIST_POLICY.preferredMaxHours &&
    hours <= WATCHLIST_POLICY.longHorizonHours
  ) {
    return 2;
  }
  if (hours === null) {
    return 3;
  }
  return 4;
}

export function compareCandidates(
  left: WatchlistSnapshot,
  right: WatchlistSnapshot,
  now: Date,
): number {
  const rankDiff =
    horizonRank(hoursUntilClose(left.closeTime, now)) -
    horizonRank(hoursUntilClose(right.closeTime, now));
  if (rankDiff !== 0) {
    return rankDiff;
  }
  return right.volumeUsd - left.volumeUsd;
}

export function pickBestPerEvent(
  docs: WatchlistSnapshot[],
  now: Date,
  maxPerEvent: number,
): Set<string> {
  const groups = new Map<string, WatchlistSnapshot[]>();
  for (const doc of docs) {
    const key = eventKey(doc, doc.marketId);
    const list = groups.get(key) ?? [];
    list.push(doc);
    groups.set(key, list);
  }
  const keep = new Set<string>();
  for (const group of groups.values()) {
    group.sort((left, right) => compareCandidates(left, right, now));
    for (const doc of group.slice(0, maxPerEvent)) {
      keep.add(doc.marketId);
    }
  }
  return keep;
}
