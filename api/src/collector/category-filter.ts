import { config } from '../config.js';
import type { MarketSnapshotsOptions } from './types.js';

/**
 * Narrowing the research dataset to specific Jupiter event categories.
 *
 * Jupiter tags events (crypto, sports, politics, …). Filtering at collection
 * time keeps MongoDB small and makes backtest/fitness runs meaningful sooner
 * than grading thousands of unrelated markets.
 */

/** Normalise category strings so "Crypto" and "crypto" match. */
function normaliseCategory(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Which categories the collector should keep.
 *
 * Schedule JSON wins over `.env` so you can experiment without restarting.
 * An empty list means "everything" — the previous default behaviour.
 */
export function effectiveCategories(options?: MarketSnapshotsOptions): string[] {
  const fromSchedule =
    options?.categories?.map(normaliseCategory).filter(Boolean) ?? [];
  if (fromSchedule.length > 0) {
    return fromSchedule;
  }
  return config.collectorCategories.map(normaliseCategory).filter(Boolean);
}

/** True when only a subset of Jupiter categories should be stored. */
export function isCategoryFilterActive(options?: MarketSnapshotsOptions): boolean {
  return effectiveCategories(options).length > 0;
}

/** Does one stored row belong to the active category filter? */
export function matchesCategory(
  category: string | undefined,
  allowed: string[],
): boolean {
  if (allowed.length === 0) {
    return true;
  }
  if (!category) {
    return false;
  }
  return allowed.includes(normaliseCategory(category));
}

/**
 * Market ids the collector is currently tracking.
 *
 * Used to filter the global /trades feed: Jupiter returns fills for every
 * market, but in crypto-only mode we only persist rows for markets we care
 * about. The set is refreshed after each wide sweep and reloaded from MongoDB
 * on startup so a restart does not forget the filter.
 */
let trackedMarketIds = new Set<string>();

export function getTrackedMarketIds(): ReadonlySet<string> {
  return trackedMarketIds;
}

export function setTrackedMarketIds(ids: Iterable<string>): void {
  trackedMarketIds = new Set(ids);
}
