import type { MarketSnapshotDoc } from '../collector/types.js';
import type { PriceFeatures } from './types.js';

const MINUTE_MS = 60_000;

/** Implied YES probability from buy yes/no prices (normalised against their sum). */
export function impliedYesProbability(snap: MarketSnapshotDoc): number {
  const total = snap.buyYesPriceUsd + snap.buyNoPriceUsd;
  if (total <= 0) {
    return 0.5;
  }
  return snap.buyYesPriceUsd / total;
}

/** Hours remaining until closeTime (unix seconds), or null when unknown. */
export function hoursToClose(closeTime: number | null, at: Date): number | null {
  if (closeTime === null || closeTime <= 0) {
    return null;
  }
  return Math.max(0, (closeTime * 1000 - at.getTime()) / 3_600_000);
}

/**
 * Find the snapshot closest to `targetMs` without going into the future,
 * searching a series already sorted oldest → newest.
 *
 * Exported so look-ahead tests and the MarketContext builder share one rule:
 * a decision at T may never see a row captured after T.
 */
export function asOfSnapshot(
  series: MarketSnapshotDoc[],
  targetMs: number,
): MarketSnapshotDoc | null {
  let found: MarketSnapshotDoc | null = null;
  for (const snap of series) {
    const t = snap.capturedAt.getTime();
    if (t > targetMs) {
      break;
    }
    found = snap;
  }
  return found;
}

/** Change in implied YES probability between now and a lookback timestamp. */
function changeOver(
  series: MarketSnapshotDoc[],
  current: MarketSnapshotDoc,
  lookbackMs: number,
): number | null {
  const nowMs = current.capturedAt.getTime();
  const past = asOfSnapshot(series, nowMs - lookbackMs);
  if (!past || past.capturedAt.getTime() === nowMs) {
    return null;
  }
  return impliedYesProbability(current) - impliedYesProbability(past);
}

/**
 * Rolling volatility = std-dev of consecutive implied-prob returns over the
 * last `windowMs` ending at `current`. Needs at least three points.
 */
function rollingVolatility(
  series: MarketSnapshotDoc[],
  current: MarketSnapshotDoc,
  windowMs: number,
): number | null {
  const endMs = current.capturedAt.getTime();
  const startMs = endMs - windowMs;
  const window = series.filter((s) => {
    const t = s.capturedAt.getTime();
    return t >= startMs && t <= endMs;
  });
  if (window.length < 3) {
    return null;
  }

  const returns: number[] = [];
  for (let i = 1; i < window.length; i += 1) {
    const prev = window[i - 1];
    const curr = window[i];
    if (!prev || !curr) {
      continue;
    }
    returns.push(impliedYesProbability(curr) - impliedYesProbability(prev));
  }
  if (returns.length < 2) {
    return null;
  }

  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

/**
 * Price / momentum features for one snapshot, given the full chronological
 * series for that market (oldest → newest).
 */
export function derivePriceFeatures(
  series: MarketSnapshotDoc[],
  current: MarketSnapshotDoc,
): PriceFeatures {
  const prev = asOfSnapshot(series, current.capturedAt.getTime() - 1);
  const volumeDelta =
    prev !== null ? current.volumeUsd - prev.volumeUsd : null;

  return {
    impliedYesProbability: impliedYesProbability(current),
    change1m: changeOver(series, current, MINUTE_MS),
    change5m: changeOver(series, current, 5 * MINUTE_MS),
    change10m: changeOver(series, current, 10 * MINUTE_MS),
    volatility: rollingVolatility(series, current, 10 * MINUTE_MS),
    volumeDelta,
    hoursToClose: hoursToClose(current.closeTime, current.capturedAt),
  };
}
