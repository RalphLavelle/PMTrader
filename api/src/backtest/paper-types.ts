import type { MarketContext } from '../features/context.js';
import type { DerivedFeatures } from '../schemas/index.js';
import type { DepthBook, ExecutionOptions } from '../trading/execution-types.js';
import type { PaperAction, PaperPosition, PaperSide } from '../trading/paper-types.js';
import type { BacktestOptions, ReplayedSignal } from './types.js';

/**
 * Types for the intramarket historical paper-replay engine.
 *
 * Extends Phase 4 decision replay with a stateful simulated portfolio so each
 * market produces a chronological paper-trading history.
 */

/** Options for one paper replay (reuses Phase 4 knobs where they still apply). */
export type PaperReplayOptions = Pick<
  BacktestOptions,
  | 'decisionIntervalMinutes'
  | 'minSnapshots'
  | 'maxSnapshotsPerMarket'
  | 'minConfidence'
  | 'requireOrderbook'
> & {
  /** Most markets to replay in a batch run. */
  maxMarkets: number;
  /** Conservative fill-physics overrides (depth, slippage, fees, excess mode). */
  execution?: Partial<ExecutionOptions>;
};

/**
 * Market conditions captured at entry or exit — used by fitness without
 * re-querying Mongo.
 */
export interface PaperTradeConditions {
  yesPriceUsd: number;
  noPriceUsd: number;
  liquidityScore: number;
  hoursToClose: number | null;
  hadOrderbook: boolean;
  change5m: number | null;
  volatility: number | null;
}

/**
 * One coherent closed paper trade (buy → sell), not an intermediate observation.
 *
 * Emitted when a sell fills (including a partial exit slice). Resolution is
 * contextual only — it must never overwrite realised trading P&L.
 *
 * grossPnlUsd = mid→mid; netPnlUsd = after ask/bid fills, slippage, and fees.
 */
export interface ClosedPaperTrade {
  marketId: string;
  side: PaperSide;
  quantity: number;
  sizeUsd: number;
  entryAt: string;
  entryPriceUsd: number;
  exitAt: string;
  exitPriceUsd: number;
  /** Mid-to-mid P&L before spread / slippage / fee drag. */
  grossPnlUsd: number;
  /** Estimated cost = gross − net (spread + slippage + fees). */
  estimatedCostUsd: number;
  /** Realised P&L after fills (buy ask → sell bid, plus costs). */
  netPnlUsd: number;
  holdingMinutes: number;
  mfeUsd: number;
  maeUsd: number;
  entryConditions: PaperTradeConditions;
  exitConditions: PaperTradeConditions;
  /** Swarm blend state at the moment the position was opened. */
  swarmStateAtEntry: {
    recommendation: 'buy_yes' | 'buy_no' | 'hold';
    confidence: number;
    approved: boolean;
    signals: ReplayedSignal[];
  };
  /** Eventual resolution when known — never used as the scoreboard. */
  resolvedTo: 'yes' | 'no' | null;
}

/**
 * One chronological paper-trading step.
 *
 * Contains the swarm decision, the paper action taken, position state, and PnL
 * figures required by the replay task.
 */
export interface PaperDecisionRecord {
  marketId: string;
  /** Decision / observation time T. */
  timestamp: string;
  yesPriceUsd: number;
  noPriceUsd: number;
  /** Bid legs so fitness can rebuild fills without reloading quotes. */
  sellYesPriceUsd: number;
  sellNoPriceUsd: number;
  /** Point-in-time derived features at T. */
  features: DerivedFeatures;
  /** Trajectory / trade-flow / book summary available at T (no look-ahead). */
  contextSummary: {
    at: string;
    historyPoints: number;
    hadOrderbook: boolean;
    change5m: number | null;
    volatility: number | null;
    tradeCount: number;
    hoursToClose: number | null;
  };
  /**
   * Compact as-of depth ladders for specialist books to reuse the same
   * execution constraints the swarm paper book saw at T.
   */
  depthBook: DepthBook | null;
  /** Full context is large; optional embed for single-market drill-down. */
  context?: MarketContext;
  signals: ReplayedSignal[];
  /** Swarm recommendation before paper mapping. */
  swarmRecommendation: 'buy_yes' | 'buy_no' | 'hold';
  approved: boolean;
  confidence: number;
  /** Proposed paper action after mapping recommendation → inventory rules. */
  proposedAction: PaperAction;
  /** Action actually applied (hold when a guard rejected the proposal). */
  appliedAction: PaperAction;
  rejectionReason: string | null;
  /** Side implied by the proposed action, when directional. */
  proposedSide: PaperSide | null;
  proposedEntryPriceUsd: number | null;
  /** Exit fill when a sell executed this step; null otherwise. */
  proposedExitPriceUsd: number | null;
  filledSizeUsd: number;
  rejectedSizeUsd: number;
  /** Simulated position after this step. */
  position: PaperPosition | null;
  entryAt: string | null;
  exitAt: string | null;
  realisedPnlUsd: number | null;
  unrealisedPnlUsd: number | null;
  /** Cumulative realised PnL across the market so far. */
  cumulativeRealisedPnlUsd: number;
  mfeUsd: number | null;
  maeUsd: number | null;
  holdingMinutes: number | null;
  /** Answer key when known — never used as an input to the decision. */
  resolvedTo: 'yes' | 'no' | null;
}

/** Complete paper-trading history for one market. */
export interface PaperMarketHistory {
  marketId: string;
  title: string;
  startedAt: string;
  finishedAt: string;
  firstTimestamp: string;
  lastTimestamp: string;
  /** Resolution when labelled; null if still open / unsettled. */
  resolvedTo: 'yes' | 'no' | null;
  options: PaperReplayOptions;
  decisions: PaperDecisionRecord[];
  /** Coherent closed trades only (not every observation). */
  closedTrades: ClosedPaperTrade[];
  /** Final portfolio totals. */
  summary: {
    decisions: number;
    buys: number;
    sells: number;
    holds: number;
    rejectedActions: number;
    totalRealisedPnlUsd: number;
    finalUnrealisedPnlUsd: number | null;
    openPosition: PaperPosition | null;
  };
}

/** Batch paper-replay result across markets. */
export interface PaperReplaySummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  options: PaperReplayOptions;
  marketsConsidered: number;
  marketsReplayed: number;
  skipped: Array<{ marketId: string; reason: string }>;
  markets: Array<{
    marketId: string;
    title: string;
    eventTitle?: string;
    category?: string;
    decisions: number;
    totalRealisedPnlUsd: number;
    finalUnrealisedPnlUsd: number | null;
    resolvedTo: 'yes' | 'no' | null;
  }>;
  /** Full histories — may be large; single-market route returns one history. */
  histories: PaperMarketHistory[];
}
