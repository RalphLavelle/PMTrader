import { config } from '../config.js';
import type { PaperExitReason, PaperPosition, StopKind } from './paper-types.js';

/**
 * Paper exit gate — the seatbelt sibling of `entry-gate.ts`.
 *
 * Specialists only say yes / no / hold. This module decides whether an *open*
 * lot must be sold even if they still like the story. The recipe is frozen at
 * fill so a later .env change cannot rewrite a trade that is already on.
 */

/** Tunable limits, injected so tests do not depend on the process env. */
export interface StopLimits {
  enabled: boolean;
  /** Fill price at or below this uses a trailing stop; above it, a fixed floor. */
  cheapMaxPriceUsd: number;
  /** Fixed-stop fraction of entry (0.30 = sell at 70% of the entry price). */
  stopLossPct: number;
  /** Trailing distance as a fraction of entry (0.40 of $0.40 = $0.16). */
  trailPct: number;
  /**
   * Minutes after entry before a trailing stop may fire. Fixed stops and the
   * time-stop ignore this. 0 = arm immediately.
   */
  trailGraceMinutes: number;
  /** Minutes after entry to cut a still-unprofitable hold; 0 disables. */
  timeStopMinutes: number;
  /** When true, the clock only fires if unrealised P&L is still ≤ 0. */
  timeStopNeedProfit: boolean;
}

/**
 * Built-in recipe from the learning reports:
 * −30% fixed / 40% trail / 60m trail grace / 24h time-stop.
 */
export const DEFAULT_STOP_LIMITS: StopLimits = {
  enabled: true,
  cheapMaxPriceUsd: 0.5,
  stopLossPct: 0.3,
  trailPct: 0.4,
  trailGraceMinutes: 60,
  timeStopMinutes: 1_440,
  timeStopNeedProfit: true,
};

/** Read the live recipe from config (env). */
export function configuredStopLimits(): StopLimits {
  return {
    enabled: config.paperStopEnabled,
    cheapMaxPriceUsd: config.paperStopCheapMaxPriceUsd,
    stopLossPct: config.paperStopLossPct,
    trailPct: config.paperTrailPct,
    trailGraceMinutes: config.paperTrailGraceMinutes,
    timeStopMinutes: config.paperTimeStopMinutes,
    timeStopNeedProfit: config.paperTimeStopNeedProfit,
  };
}

/** Cheap-side (mean-reversion style) trails; expensive-side (trend style) is fixed. */
export function chooseStopKind(
  entryPriceUsd: number,
  limits: StopLimits = DEFAULT_STOP_LIMITS,
): StopKind {
  return entryPriceUsd <= limits.cheapMaxPriceUsd ? 'trailing_price' : 'percent_loss';
}

/** Seatbelt fields copied onto a new lot. Empty when stops are disabled. */
export function bakeStopRecipe(
  entryPriceUsd: number,
  entryAt: string,
  limits: StopLimits = configuredStopLimits(),
): Pick<
  PaperPosition,
  | 'stopKind'
  | 'stopPriceUsd'
  | 'stopLossPct'
  | 'trailDistanceUsd'
  | 'trailArmedAt'
  | 'timeStopAt'
  | 'timeStopNeedProfit'
> {
  if (!limits.enabled) {
    return {};
  }

  const kind = chooseStopKind(entryPriceUsd, limits);
  const stopLossPct = clamp01(limits.stopLossPct);
  const trailPct = clamp01(limits.trailPct);
  const trailDistanceUsd = roundPrice(entryPriceUsd * trailPct);

  const stopPriceUsd =
    kind === 'percent_loss'
      ? clampPrice(roundPrice(entryPriceUsd * (1 - stopLossPct)))
      : clampPrice(roundPrice(entryPriceUsd - trailDistanceUsd));

  const entryMs = Date.parse(entryAt);
  const timeStopAt =
    limits.timeStopMinutes > 0 && Number.isFinite(entryMs)
      ? new Date(entryMs + limits.timeStopMinutes * 60_000).toISOString()
      : undefined;

  // Trail grace: freeze the arm time so later env changes cannot rewrite open lots.
  const graceMinutes = Math.max(0, limits.trailGraceMinutes);
  const trailArmedAt =
    kind === 'trailing_price' && Number.isFinite(entryMs)
      ? new Date(entryMs + graceMinutes * 60_000).toISOString()
      : undefined;

  return {
    stopKind: kind,
    stopPriceUsd,
    stopLossPct,
    ...(kind === 'trailing_price' ? { trailDistanceUsd, trailArmedAt } : {}),
    ...(timeStopAt
      ? { timeStopAt, timeStopNeedProfit: limits.timeStopNeedProfit }
      : {}),
  };
}

/**
 * Raise a trailing floor toward the current bid. Never lowers it.
 * No-op for fixed stops or lots that have no recipe.
 */
export function ratchetTrailingStop(
  position: PaperPosition,
  markPriceUsd: number,
): PaperPosition {
  if (
    position.stopKind !== 'trailing_price' ||
    position.trailDistanceUsd === undefined ||
    position.stopPriceUsd === undefined
  ) {
    return position;
  }

  const raised = roundPrice(markPriceUsd - position.trailDistanceUsd);
  const nextStop = clampPrice(Math.max(position.stopPriceUsd, raised));
  if (nextStop === position.stopPriceUsd) {
    return position;
  }
  return { ...position, stopPriceUsd: nextStop };
}

/**
 * Return why this lot must be sold right now, or null to leave it alone.
 *
 * `markPriceUsd` is the sell bid (what we would actually get). Callers should
 * mark / ratchet the position first so a trail uses the updated floor.
 *
 * Trailing stops respect `trailArmedAt` (grace window). Fixed percent stops
 * and the time-stop fire regardless of grace.
 */
export function exitHitReason(
  position: PaperPosition,
  markPriceUsd: number | null,
  unrealisedPnlUsd: number | null,
  now: Date,
): Extract<PaperExitReason, 'stop_loss' | 'trailing_stop' | 'time_stop'> | null {
  const nowMs = now.getTime();

  if (
    markPriceUsd !== null &&
    position.stopPriceUsd !== undefined &&
    markPriceUsd <= position.stopPriceUsd
  ) {
    if (position.stopKind === 'trailing_price') {
      // Lots opened before trailArmedAt existed arm immediately (no grace).
      const armedMs = position.trailArmedAt
        ? Date.parse(position.trailArmedAt)
        : Number.NEGATIVE_INFINITY;
      if (Number.isFinite(armedMs) && nowMs < armedMs) {
        // Still in grace — do not trail-sell; fall through to time-stop check.
      } else {
        return 'trailing_stop';
      }
    } else {
      return 'stop_loss';
    }
  }

  if (!position.timeStopAt) {
    return null;
  }

  const deadlineMs = Date.parse(position.timeStopAt);
  if (!Number.isFinite(deadlineMs) || nowMs < deadlineMs) {
    return null;
  }

  const needProfit = position.timeStopNeedProfit !== false;
  if (needProfit && unrealisedPnlUsd !== null && unrealisedPnlUsd > 0) {
    return null;
  }

  return 'time_stop';
}

/** Reason recorded on a closed trade. Force-close (settlement) wins over a stop. */
export function closedExitReason(
  forceClose: boolean,
  position: PaperPosition,
  markPriceUsd: number | null,
  unrealisedPnlUsd: number | null,
  now: Date,
): PaperExitReason {
  if (forceClose) {
    return 'market_close';
  }
  return exitHitReason(position, markPriceUsd, unrealisedPnlUsd, now) ?? 'flip';
}

function roundPrice(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function clampPrice(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.01;
  }
  return Math.min(0.99, Math.max(0.01, value));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
