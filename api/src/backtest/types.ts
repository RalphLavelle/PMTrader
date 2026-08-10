import type { AgentName, Recommendation, RiskAssessment, Stance } from '../schemas/index.js';
import type { ExitPolicy } from '../trading/index.js';

/**
 * Phase 4 offline evaluation types.
 *
 * Primary question: would a trading decision made while the market was open
 * have generated a profitable return if exited later under the exit policy?
 *
 * Final resolution is secondary context (calibration / wasCorrect), not the
 * gate that decides whether a market can be graded.
 *
 * Nothing here is persisted. A backtest is a derived view of the collected
 * dataset — if the maths improves, re-run rather than migrate stale rows.
 */

/** Knobs for one backtest run. Defaults come from config; routes may override. */
export interface BacktestOptions {
  /** Most markets (by recent activity) to replay. */
  maxMarkets: number;
  /**
   * Minutes between decision points inside one market's history.
   *
   * The collector may store a snapshot every few seconds. Grading every one of
   * those would count the same opinion hundreds of times.
   */
  decisionIntervalMinutes: number;
  /**
   * Minutes to hold a hypothetical position before looking for an exit quote.
   * Defaults to the same value as `decisionIntervalMinutes` (exit at the next
   * decision cadence).
   */
  exitHoldMinutes: number;
  /** Fewest snapshots a market must have before replaying it is meaningful. */
  minSnapshots: number;
  /** Snapshots loaded per market — a memory cap, not a statistical choice. */
  maxSnapshotsPerMarket: number;
  /**
   * The confidence bar a trade must clear, overriding `SWARM_MIN_CONFIDENCE`.
   */
  minConfidence: number;
  /**
   * Only grade decisions where a stored orderbook was available.
   */
  requireOrderbook: boolean;
}

/** What one specialist thought at a decision point. Kept for Phase 5 fitness. */
export interface ReplayedSignal {
  agent: AgentName;
  stance: Stance;
  confidence: number;
}

/** A decision replayed at a point in time, before any exit is applied. */
export interface ReplayedDecision {
  marketId: string;
  decidedAt: string;
  recommendation: Recommendation;
  approved: boolean;
  confidence: number;
  yesLikelihood: number;
  positionSizeUsd: number;
  /** Price the position would have been opened at, or null when holding. */
  entryPriceUsd: number | null;
  impliedYesProbability: number;
  liquidityScore: number;
  hoursToClose: number | null;
  /** True when a stored orderbook was available; depth is zero otherwise. */
  hadOrderbook: boolean;
  vetoReasons: RiskAssessment['vetoReasons'];
  signals: ReplayedSignal[];
}

/**
 * The reference strategy every decision is measured against: buy whichever side
 * the market itself already favours, then exit under the same policy.
 */
export interface BaselineDecision {
  recommendation: Recommendation;
  /** Primary: was the intramarket trade profitable? */
  wasProfitable: boolean | null;
  /** Secondary: matched eventual resolution when known. */
  wasCorrect: boolean | null;
  realizedPnlUsd: number | null;
  stakedUsd: number;
  exitAt: string | null;
  exitPriceUsd: number | null;
}

/** A replayed decision graded with an exit (and optional resolution). */
export interface ScoredDecision extends ReplayedDecision {
  /** Exit policy used to find the exit quote. */
  exitPolicy: ExitPolicy;
  exitAt: string | null;
  exitPriceUsd: number | null;
  /** How PnL was computed. */
  scoringMode: 'intramarket' | 'unresolved';
  /** Primary success signal: intramarket PnL > 0. */
  wasProfitable: boolean | null;
  /** Secondary: matched resolution when a label exists. */
  wasCorrect: boolean | null;
  /** Optional answer key — null when the market has not resolved. */
  resolvedTo: 'yes' | 'no' | null;
  realizedPnlUsd: number | null;
  /** Quotes used for entry (always present). */
  entryQuote: { buyYesPriceUsd: number; buyNoPriceUsd: number };
  /** Quotes used for exit (null when unresolved). */
  exitQuote: { buyYesPriceUsd: number; buyNoPriceUsd: number } | null;
  baseline: BaselineDecision;
}

/** Aggregate performance of a set of decisions. */
export interface PerformanceStats {
  decisions: number;
  directionalDecisions: number;
  holdDecisions: number;
  /** Directional bets with positive intramarket PnL. */
  profitableDecisions: number;
  /** Directional bets with negative intramarket PnL. */
  unprofitableDecisions: number;
  /**
   * Share of scorable directional bets that were profitable.
   * This is the primary accuracy figure under the trading objective.
   */
  accuracy: number | null;
  /**
   * Share that matched eventual resolution, when resolution was known.
   * Secondary — may be null when few markets have resolved.
   */
  resolutionAccuracy: number | null;
  correctDecisions: number;
  incorrectDecisions: number;
  totalStakedUsd: number;
  totalPnlUsd: number;
  /** Profit per dollar risked. The number that actually matters. */
  returnOnStake: number | null;
  /** Directional decisions whose exit/entry was unusable. */
  unscorable: number;
}

/**
 * One band of the calibration curve (secondary — needs resolution).
 */
export interface CalibrationBucket {
  lowerBound: number;
  upperBound: number;
  decisions: number;
  meanPredicted: number;
  observedYesRate: number;
}

/** Why a market was left out of the run. */
export interface SkippedMarket {
  marketId: string;
  reason: string;
}

/** How often each Risk Manager veto fired. */
export interface VetoTally {
  reason: string;
  decisions: number;
}

/** Per-market rollup. */
export interface MarketBacktestResult {
  marketId: string;
  title: string;
  eventTitle?: string;
  category?: string;
  /** Decisive result when labelled; null if still open / unsettled. */
  result: 'yes' | 'no' | null;
  firstDecisionAt: string;
  lastDecisionAt: string;
  stats: PerformanceStats;
}

/** Everything one backtest run produced. */
export interface BacktestSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  options: BacktestOptions;
  riskLimits: {
    maxPositionUsd: number;
    minPositionUsd: number;
    minConfidence: number;
  };
  /** Specialists that took part; the semantic agent is deliberately absent. */
  agents: AgentName[];
  marketsConsidered: number;
  marketsEvaluated: number;
  skipped: SkippedMarket[];
  decisionsWithOrderbook: number;
  /** How many graded decisions used an intramarket exit. */
  decisionsWithExit: number;
  strategy: PerformanceStats;
  baseline: PerformanceStats;
  /** Resolution calibration — empty when no markets have resolved. */
  calibration: CalibrationBucket[];
  vetoes: VetoTally[];
  markets: MarketBacktestResult[];
}

/** Full drill-down for a single market. */
export interface MarketBacktestDetail {
  result: MarketBacktestResult;
  decisions: ScoredDecision[];
}
