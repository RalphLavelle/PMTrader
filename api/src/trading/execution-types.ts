/**
 * Configurable paper-execution assumptions.
 *
 * These knobs exist so backtests stay honest: never fill at mid, respect
 * available depth when we have a book, and apply conservative defaults when
 * we do not. They are not tuned to make historical P&L look better.
 */

/** What to do when the order is larger than resting depth. */
export type ExcessLiquidityMode = 'partial_fill' | 'reject_excess';

/**
 * Explicit fill-physics settings used by the paper book.
 *
 * Documented in README / ResearchDataset so a surprising number can be traced
 * back to a named assumption rather than a silent mid-price fantasy.
 */
export interface ExecutionOptions {
  /**
   * `partial_fill` — take what the book offers, reject the unfilled remainder.
   * `reject_excess` — refuse the whole order unless depth covers it.
   */
  excessMode: ExcessLiquidityMode;
  /**
   * Extra adverse move after the book walk / top-of-book, in basis points.
   * Buys pay more; sells receive less. Models queue/impact beyond the spread.
   */
  slippageBps: number;
  /**
   * Flat fee on filled notional, in basis points (charged on each filled leg).
   * Shows up in estimatedCostUsd / net P&L, never in gross (mid→mid) P&L.
   */
  feeBps: number;
  /**
   * When no orderbook ladder is available at T, assume only this much USD
   * notional can trade at the top-of-book quote. Prevents pretending thin
   * markets have infinite depth just because a mid appeared in the archive.
   */
  noBookDepthUsd: number;
  /**
   * Minimum fraction of the requested size that must fill. Below this the
   * whole order is rejected (avoids dust opens that look like real trades).
   */
  minFillFraction: number;
}

/** Defaults — deliberately conservative, not performance-optimised. */
export const DEFAULT_EXECUTION_OPTIONS: ExecutionOptions = {
  excessMode: 'partial_fill',
  slippageBps: 10,
  feeBps: 0,
  noBookDepthUsd: 25,
  minFillFraction: 0.25,
};

/** Dollar ladders from a stored Jupiter orderbook (bids on each outcome). */
export interface DepthBook {
  yesDollars: Array<[string, number]>;
  noDollars: Array<[string, number]>;
}

/** How a fill was priced. */
export type FillPricing = 'depth_walk' | 'top_of_book' | 'none';

/**
 * Result of simulating one order against quote + optional depth.
 *
 * `fillPriceUsd` is the volume-weighted price after slippage — never a mid.
 * `rejectedSizeUsd` / `rejectedContracts` are the unfilled excess.
 */
export interface SimulatedFill {
  ok: boolean;
  reason: string | null;
  pricing: FillPricing;
  /** VWAP after adverse slippage; null when nothing filled. */
  fillPriceUsd: number | null;
  filledSizeUsd: number;
  rejectedSizeUsd: number;
  filledContracts: number;
  rejectedContracts: number;
  /** Fee charged on this leg (USD). */
  feeUsd: number;
  /** True when a depth ladder constrained or priced the fill. */
  usedDepth: boolean;
}
