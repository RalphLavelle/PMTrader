import type {
  DepthBook,
  ExecutionOptions,
  FillPricing,
} from './execution-types.js';

/** Which side of the binary market the paper book is long. */
export type PaperSide = 'yes' | 'no';

/**
 * Actions the paper book can take.
 *
 * BUY/HOLD mirror the live swarm recommendation. SELL is paper-only for now —
 * the swarm does not yet emit exits; the replay engine maps flip/close signals
 * onto sell_yes / sell_no.
 */
export type PaperAction = 'buy_yes' | 'buy_no' | 'sell_yes' | 'sell_no' | 'hold';

/**
 * Full quote used by the conservative fill model.
 *
 * Buys fill at the ask (`buy*PriceUsd`); sells fill at the bid (`sell*PriceUsd`).
 * Mid is never used as an execution price — only for gross P&L reporting.
 */
export interface FullQuote {
  buyYesPriceUsd: number;
  buyNoPriceUsd: number;
  sellYesPriceUsd: number;
  sellNoPriceUsd: number;
}

/** Open simulated position, including excursion trackers. */
export interface PaperPosition {
  side: PaperSide;
  /** Notional USD committed at entry (may be less than requested on partial fill). */
  sizeUsd: number;
  /** Contracts opened at entry (exact from the fill). */
  contracts: number;
  entryAt: string;
  entryPriceUsd: number;
  /** Best (highest) unrealised PnL seen since entry. */
  mfeUsd: number;
  /** Worst (lowest) unrealised PnL seen since entry. */
  maeUsd: number;
}

/** Portfolio carried across the chronological loop. */
export interface PaperPortfolio {
  position: PaperPosition | null;
  /** Cumulated realised PnL from closed trades (net of fees). */
  realisedPnlUsd: number;
}

/** Optional depth + execution knobs for one apply call. */
export interface PaperApplyOptions {
  book?: DepthBook | null;
  execution?: Partial<ExecutionOptions>;
}

/** Result of trying to apply one paper action. */
export interface PaperApplyResult {
  portfolio: PaperPortfolio;
  /** Action actually applied (may differ from proposed if rejected → hold). */
  appliedAction: PaperAction;
  /** Why an action was refused; null when applied as proposed. */
  rejectionReason: string | null;
  /**
   * Realised PnL from this step (non-zero on a successful sell — net of the
   * exit fee). Partial sells realise only the closed slice.
   */
  stepRealisedPnlUsd: number;
  /** Fill price used, when a buy or sell executed. */
  fillPriceUsd: number | null;
  /** Notional that filled this step. */
  filledSizeUsd: number;
  /** Requested notional that could not fill (buys). */
  rejectedSizeUsd: number;
  /** Contracts filled this step. */
  filledContracts: number;
  /** Contracts that could not fill (sells). */
  rejectedContracts: number;
  /** Fee charged on this leg. */
  feeUsd: number;
  /** How the fill was priced. */
  fillPricing: FillPricing;
  /** True when a depth ladder constrained or priced the fill. */
  usedDepth: boolean;
  /**
   * When a sell only partially closed the position, the remaining open lot.
   * Null when flat after a full exit, or when no sell happened.
   */
  residualPosition: PaperPosition | null;
}

/** Re-export depth book for callers that only import paper-types. */
export type { DepthBook };
