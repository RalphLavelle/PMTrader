import type { AgentName, Recommendation, RiskAssessment, Stance } from '../schemas/index.js';

/**
 * Phase 4 offline evaluation types.
 *
 * Nothing here is persisted. A backtest is a *derived* view of the collected
 * dataset, exactly like the Phase 2 features: if the maths improves, re-run it
 * rather than migrating stale rows.
 */

/** Knobs for one backtest run. Defaults come from config; routes may override. */
export interface BacktestOptions {
  /** Most resolved markets to replay. */
  maxMarkets: number;
  /**
   * Minutes between decision points inside one market's history.
   *
   * The collector may store a snapshot every few seconds. Grading every one of
   * those would count the same opinion hundreds of times and make a tiny sample
   * look like a large one, so decisions are thinned to a fixed cadence.
   */
  decisionIntervalMinutes: number;
  /** Fewest snapshots a market must have before replaying it is meaningful. */
  minSnapshots: number;
  /** Snapshots loaded per market — a memory cap, not a statistical choice. */
  maxSnapshotsPerMarket: number;
  /**
   * The confidence bar a trade must clear, overriding `SWARM_MIN_CONFIDENCE`.
   *
   * Sweeping a threshold is one of the main things a backtest is for: "would
   * this strategy have made money at 0.30 instead of 0.55?" is a question you
   * want to answer in a query string, not by editing `.env` and restarting.
   * Every other risk limit stays at its production value.
   */
  minConfidence: number;
  /**
   * Only grade decisions where a stored orderbook was available.
   *
   * The wide sweep covers hundreds of markets but the orderbook stream only
   * covers the watchlist, so most markets have prices with no depth behind
   * them. Off by default (a bigger, blinder sample); on to ask the narrower
   * question "how does the strategy do when it can actually see the book?".
   */
  requireOrderbook: boolean;
}

/** What one specialist thought at a decision point. Kept for Phase 5 fitness. */
export interface ReplayedSignal {
  agent: AgentName;
  stance: Stance;
  confidence: number;
}

/** A decision replayed at a point in time, before the answer is revealed. */
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
 * the market itself already favours.
 *
 * Without it a headline accuracy figure is unreadable. Prediction-market
 * favourites win most of the time, so "70% correct" can easily be worse than
 * doing no analysis at all.
 */
export interface BaselineDecision {
  recommendation: Recommendation;
  wasCorrect: boolean | null;
  realizedPnlUsd: number | null;
  stakedUsd: number;
}

/** A replayed decision graded against the market's known outcome. */
export interface ScoredDecision extends ReplayedDecision {
  resolvedTo: 'yes' | 'no';
  /** Null for holds — declining to bet says nothing about skill. */
  wasCorrect: boolean | null;
  realizedPnlUsd: number | null;
  baseline: BaselineDecision;
}

/** Aggregate performance of a set of decisions. */
export interface PerformanceStats {
  decisions: number;
  directionalDecisions: number;
  holdDecisions: number;
  correctDecisions: number;
  incorrectDecisions: number;
  /** correct / (correct + incorrect). Null when nothing directional happened. */
  accuracy: number | null;
  totalStakedUsd: number;
  totalPnlUsd: number;
  /** Profit per dollar risked. The number that actually matters. */
  returnOnStake: number | null;
  /** Directional decisions whose entry price was unusable, so PnL is unknown. */
  unscorable: number;
}

/**
 * One band of the calibration curve.
 *
 * Calibration asks a different question from accuracy: when the swarm says
 * "70% likely YES", do roughly 70% of those markets resolve YES? A strategy can
 * be accurate and badly calibrated, and Phase 6 cannot weight a specialist it
 * cannot trust the confidence of.
 */
export interface CalibrationBucket {
  lowerBound: number;
  upperBound: number;
  decisions: number;
  /** Mean stated P(YES) in this band. */
  meanPredicted: number;
  /** Share of these markets that actually resolved YES. */
  observedYesRate: number;
}

/** Why a labelled market was left out of the run. */
export interface SkippedMarket {
  marketId: string;
  reason: string;
}

/**
 * How often each Risk Manager veto fired.
 *
 * A backtest that grades nothing is the normal early result, not a bug: the
 * strategy is allowed to decline every bet. Without this tally the report would
 * be a wall of zeroes with no explanation, and the reader could not tell
 * "the market had already closed" from "confidence was never high enough".
 */
export interface VetoTally {
  reason: string;
  decisions: number;
}

/** Per-market rollup, so a single bad market cannot hide inside the total. */
export interface MarketBacktestResult {
  marketId: string;
  title: string;
  result: 'yes' | 'no';
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
  /**
   * How many graded decisions had real depth behind them. A low share means
   * the depth-driven parts of every signal were effectively switched off.
   */
  decisionsWithOrderbook: number;
  strategy: PerformanceStats;
  baseline: PerformanceStats;
  calibration: CalibrationBucket[];
  /** Most common reasons a decision never became a bet, commonest first. */
  vetoes: VetoTally[];
  markets: MarketBacktestResult[];
}

/** Full drill-down for a single market: its rollup plus every graded decision. */
export interface MarketBacktestDetail {
  result: MarketBacktestResult;
  decisions: ScoredDecision[];
}
