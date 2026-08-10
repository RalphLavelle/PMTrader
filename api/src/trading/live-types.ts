import type { ClosedPaperTrade, PaperTradeConditions } from '../backtest/paper-types.js';
import type { AgentName } from '../schemas/index.js';
import type { CompletedFitnessTrade } from '../fitness/types.js';
import type { FullQuote, PaperPortfolio, PaperPosition } from './paper-types.js';

/**
 * Durable live paper-trading state.
 *
 * PAPER TRADING ONLY — never touches real order APIs.
 */

/** How the loop classified this step for logging / dashboards. */
export type PaperIntent = 'enter' | 'hold' | 'add' | 'reduce' | 'exit';

/** Entry metadata kept until the swarm lot fully closes (survives restarts). */
export interface LiveEntryMeta {
  entryQuote: FullQuote;
  entryConditions: PaperTradeConditions;
  swarmStateAtEntry: ClosedPaperTrade['swarmStateAtEntry'];
  adaptiveWeightsAtEntry: Partial<Record<AgentName, number>> | null;
}

/** One market's simulated book + bookkeeping, persisted in MongoDB. */
export interface LivePaperMarketState {
  marketId: string;
  title: string;
  /** Swarm paper portfolio for this market. */
  portfolio: PaperPortfolio;
  /** Unit-stake specialist books (trend + mean-reversion) for adaptive evidence. */
  specialistPortfolios: Partial<Record<AgentName, PaperPortfolio>>;
  entryMeta: LiveEntryMeta | null;
  specialistEntryMeta: Partial<
    Record<
      AgentName,
      {
        entryQuote: FullQuote;
        entryConditions: PaperTradeConditions;
        stanceConfidence: number;
      }
    >
  >;
  /** Last collector observation we acted on (duplicate guard). */
  lastObservationAt: string | null;
  lastContentHash: string | null;
  /** Last time the decision engine ran (cadence guard). */
  lastDecisionAt: string | null;
  unrealisedPnlUsd: number | null;
  /** open | closed | missing — market lifecycle as the loop last saw it. */
  marketStatus: string;
  updatedAt: string;
  createdAt: string;
}

/** One recorded live decision (append-only audit trail). */
export interface LivePaperDecisionDoc {
  id: string;
  marketId: string;
  timestamp: string;
  observationAt: string;
  intent: PaperIntent;
  proposedAction: string;
  appliedAction: string;
  rejectionReason: string | null;
  vetoReasons: string[];
  approved: boolean;
  confidence: number;
  recommendation: string;
  filledSizeUsd: number;
  rejectedSizeUsd: number;
  fillPriceUsd: number | null;
  realisedPnlUsd: number | null;
  unrealisedPnlUsd: number | null;
  cumulativeRealisedPnlUsd: number;
  position: PaperPosition | null;
  stale: boolean;
  duplicateObservation: boolean;
  createdAt: string;
}

/** Closed live trade stored for fitness / adaptive refresh. */
export interface LiveClosedTradeDoc extends ClosedPaperTrade {
  id: string;
  owner: AgentName | 'swarm';
  adaptiveWeightsAtEntry: Partial<Record<AgentName, number>> | null;
  source: 'live_paper';
  createdAt: string;
}

/** Adaptive weight snapshot persisted so restarts keep influence multipliers. */
export interface LiveAdaptiveSnapshotDoc {
  _id: 'current';
  table: import('../adaptive/types.js').AdaptiveWeightTable;
  trades: CompletedFitnessTrade[];
  updatedAt: string;
}

/** Summary of one scheduler pass. */
export interface LivePaperPassResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  marketsConsidered: number;
  marketsProcessed: number;
  skippedStale: number;
  skippedDuplicate: number;
  entries: number;
  exits: number;
  rejects: number;
  riskVetoes: number;
  closedTrades: number;
  errors: string[];
}
