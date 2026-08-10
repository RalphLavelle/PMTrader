import type { BacktestOptions, CalibrationBucket, SkippedMarket } from '../backtest/index.js';
import type { AgentName, Stance } from '../schemas/index.js';

/**
 * Phase 5 agent fitness types.
 *
 * Primary signal: coherent intramarket paper trades (entry → exit).
 * Secondary: resolution Brier / wasCorrect forecasting diagnostics.
 */

export type FitnessSource = 'backtest' | 'live_run' | 'paper_replay';

/** Who a completed trade is attributed to. */
export type TradeOwner = AgentName | 'swarm';

/** Knobs for one fitness report. */
export interface FitnessOptions {
  /** Replay settings handed to Phase 4 / paper engines. */
  backtest: BacktestOptions;
  /** Read stored swarm runs too — the only way the semantic agent gets graded. */
  includeLiveRuns: boolean;
  /** Most stored runs to examine. MongoDB only, so this is cheap. */
  maxRuns: number;
  /**
   * Fewest completed trades before a suggested weight is anything but neutral.
   */
  minSampleForWeight: number;
  /** Unit stake used when simulating each specialist's own paper book. */
  specialistStakeUsd: number;
}

/**
 * One specialist's opinion at one moment, with forecasting outcome attached.
 * Kept as secondary diagnostics ("good forecaster" vs "good trader").
 */
export interface GradedStance {
  agent: AgentName;
  source: FitnessSource;
  marketId: string;
  decidedAt: string;
  stance: Stance;
  confidence: number;
  /** P(YES) the stance implies, using the Risk Manager's own mapping. */
  predictedYes: number;
  /** P(YES) the market itself showed at that moment. */
  marketYes: number;
  /**
   * Eventual resolution when known — secondary context for Brier calibration.
   * Null when the market has not resolved (still gradable via wasProfitable).
   */
  resolvedTo: 'yes' | 'no' | null;
  /** Legacy stance-as-trade profitability (secondary). */
  wasProfitable: boolean | null;
  /** Mark-to-market PnL of a unit stake on this stance's side; null if neutral. */
  tradePnlUsd: number | null;
  scoringMode: 'intramarket' | 'resolution' | 'unresolved';
  liquidityScore: number;
  hoursToClose: number | null;
  hadOrderbook: boolean;
}

/** How well a set of forecasting stances did (secondary scoreboard). */
export interface StanceStats {
  stances: number;
  directional: number;
  neutral: number;
  /** Directional stances that were profitable under the exit policy. */
  profitable: number;
  unprofitable: number;
  /** profitable / (profitable + unprofitable). */
  accuracy: number | null;
  /** Matched eventual resolution when known — secondary. */
  resolutionAccuracy: number | null;
  correct: number;
  incorrect: number;
  meanConfidence: number | null;
  /** Mean unit-stake intramarket PnL across directional stances. */
  meanTradePnlUsd: number | null;
  /**
   * Mean Brier vs resolution when resolution is known; null otherwise.
   * Secondary forecast metric — not the trading scoreboard.
   */
  brierScore: number | null;
  marketBrierScore: number | null;
  skillVsMarket: number | null;
  /** meanConfidence − trading accuracy. */
  overconfidence: number | null;
}

/**
 * Market conditions at entry or exit of a coherent trade.
 */
export interface TradeConditions {
  yesPriceUsd: number;
  noPriceUsd: number;
  liquidityScore: number;
  hoursToClose: number | null;
  hadOrderbook: boolean;
  change5m: number | null;
  volatility: number | null;
}

/**
 * One completed simulated trade retained for fitness.
 *
 * Built only from coherent buy→sell cycles — never from every observation.
 */
export interface CompletedFitnessTrade {
  marketId: string;
  owner: TradeOwner;
  entryAt: string;
  entryPriceUsd: number;
  exitAt: string;
  exitPriceUsd: number;
  side: 'yes' | 'no';
  quantity: number;
  sizeUsd: number;
  grossPnlUsd: number;
  estimatedCostUsd: number;
  netPnlUsd: number;
  holdingMinutes: number;
  mfeUsd: number;
  maeUsd: number;
  entryConditions: TradeConditions;
  exitConditions: TradeConditions;
  /** Swarm blend at entry (signals + recommendation). */
  swarmStateAtEntry: {
    recommendation: 'buy_yes' | 'buy_no' | 'hold';
    confidence: number;
    approved: boolean;
    signals: Array<{ agent: AgentName; stance: Stance; confidence: number }>;
  };
  /** Contextual only — must not overwrite realised trading P&L. */
  resolvedTo: 'yes' | 'no' | null;
  /**
   * Adaptive influence weights published at entry time (Phase 6), when any.
   * Null before the first fitness-driven weight refresh.
   */
  adaptiveWeightsAtEntry: Partial<Record<AgentName, number>> | null;
}

/** Behavioural tallies beyond raw P&L. */
export interface TradeBehaviourStats {
  missedOpportunities: number;
  prematureExits: number;
  losingExits: number;
  heldTooLong: number;
  drawdownEvents: number;
}

export type RegimeDimension =
  | 'liquidity'
  | 'time_to_close'
  | 'market_conviction'
  | 'orderbook';

export interface RegimeFitness {
  dimension: RegimeDimension;
  bucket: string;
  description: string;
  /** Secondary forecasting stats in this bucket. */
  stats: StanceStats;
  /** Primary trading stats in this bucket (null when no trades landed here). */
  trading: TradingPerformance | null;
}

/**
 * Primary fitness scoreboard for one owner (swarm or specialist).
 */
export interface TradingPerformance {
  /** Net realised P&L after fills / costs (primary scoreboard number). */
  realisedPnlUsd: number;
  /** Mid→mid gross P&L before spread / slippage / fee drag. */
  grossPnlUsd: number;
  /** Net P&L / total capital deployed across closed trades. */
  returnOnCapital: number | null;
  trades: number;
  winRate: number | null;
  /** Mean net P&L across all closed trades. */
  avgTradePnlUsd: number | null;
  avgProfitPerTrade: number | null;
  avgLossPerTrade: number | null;
  /** Gross wins / abs(gross losses); null when no losses. */
  profitFactor: number | null;
  largestWinnerUsd: number | null;
  largestLoserUsd: number | null;
  maxDrawdownUsd: number;
  avgHoldingMinutes: number | null;
  avgMfeUsd: number | null;
  avgMaeUsd: number | null;
  /**
   * Realised P&L / max drawdown when drawdown > 0; otherwise null.
   * Simple risk-adjusted return — enough for ranking specialists.
   */
  riskAdjustedReturn: number | null;
  behaviour: TradeBehaviourStats;
}

export interface SuggestedWeight {
  weight: number;
  reliable: boolean;
  sampleSize: number;
  rationale: string;
}

export interface AgentFitness {
  agent: AgentName;
  /** Primary: coherent paper-trade performance. */
  trading: TradingPerformance;
  /** Secondary: resolution / Brier forecasting diagnostics. */
  forecasting: StanceStats;
  /** @deprecated Prefer `forecasting` — kept for older clients during transition. */
  overall: StanceStats;
  bySource: Array<{ source: FitnessSource; stats: StanceStats }>;
  calibration: CalibrationBucket[];
  regimes: RegimeFitness[];
  weight: SuggestedWeight;
  trades: CompletedFitnessTrade[];
}

export interface HeadToHead {
  agentA: AgentName;
  agentB: AgentName;
  comparisons: number;
  agreements: number;
  disagreements: number;
  agentAWins: number;
  agentBWins: number;
  agreementAccuracy: number | null;
}

export interface SourceSummary {
  source: FitnessSource;
  stances: number;
  markets: number;
  agents: AgentName[];
  note: string;
}

export interface FitnessReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  options: FitnessOptions;
  sources: SourceSummary[];
  gradedStances: number;
  /** Completed coherent trades across swarm + specialists. */
  completedTrades: number;
  marketsCovered: number;
  /** Swarm-as-a-whole paper book — primary scoreboard headline. */
  swarm: TradingPerformance;
  swarmTrades: CompletedFitnessTrade[];
  agents: AgentFitness[];
  headToHead: HeadToHead[];
  skipped: SkippedMarket[];
  warnings: string[];
}
