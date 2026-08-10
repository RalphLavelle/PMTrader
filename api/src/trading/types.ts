import type { Recommendation } from '../schemas/index.js';

/**
 * Intramarket trading contracts.
 *
 * PMTrader's primary question is no longer "did we pick the eventual winner?".
 * It is: given information available while a market was still open, would a
 * trade entered then and exited later (still before — or at — close) have made
 * a profitable risk-adjusted return?
 *
 * Final resolution is useful context, but it is not the scoreboard.
 */

/**
 * How long to hold a hypothetical position before looking for an exit quote.
 *
 * Start simple: one fixed hold. Take-profit / stop-loss / "exit when the swarm
 * flips" can be added later as alternative policies without changing the PnL
 * maths — only the rule that picks the exit snapshot changes.
 */
export interface ExitPolicy {
  /** Minutes after entry before we accept an exit snapshot. */
  holdMinutes: number;
  /**
   * Human-readable name for reports ("fixed_hold").
   * Kept as a string so future policies can share the same field.
   */
  kind: 'fixed_hold';
}

/** The two prices needed to mark a binary-contract position to market. */
export interface QuotePrices {
  buyYesPriceUsd: number;
  buyNoPriceUsd: number;
}

/**
 * One hypothetical trade from entry to exit.
 *
 * This is the atom of intramarket evaluation — analogous to what a "resolved
 * forecast" used to be under the old objective.
 */
export interface TradeEpisode {
  recommendation: Recommendation;
  positionSizeUsd: number;
  entryAt: string;
  entryPriceUsd: number | null;
  exitAt: string | null;
  exitPriceUsd: number | null;
  holdMinutes: number;
  /** Mark-to-market PnL if the position was closed at the exit quote. */
  realizedPnlUsd: number | null;
  /** True when realizedPnlUsd > 0; null when unscorable or a hold. */
  wasProfitable: boolean | null;
  /**
   * How this episode was graded.
   * - intramarket: exit quote found; primary scoreboard
   * - unresolved: no usable exit yet
   */
  scoringMode: 'intramarket' | 'unresolved';
}

/** Build the default fixed-hold exit policy. */
export function fixedHoldPolicy(holdMinutes: number): ExitPolicy {
  return {
    kind: 'fixed_hold',
    holdMinutes: Math.max(1, Math.round(holdMinutes)),
  };
}
