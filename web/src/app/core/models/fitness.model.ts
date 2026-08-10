/** Types for the Phase 5 agent fitness dashboard — mirror /api/fitness responses. */

import { CalibrationBucket } from './backtest.model';

export type FitnessSource = 'backtest' | 'live_run' | 'paper_replay';

export interface StanceStats {
  stances: number;
  directional: number;
  neutral: number;
  profitable: number;
  unprofitable: number;
  /** Secondary stance-as-trade accuracy. */
  accuracy: number | null;
  resolutionAccuracy: number | null;
  correct: number;
  incorrect: number;
  meanConfidence: number | null;
  meanTradePnlUsd: number | null;
  brierScore: number | null;
  marketBrierScore: number | null;
  skillVsMarket: number | null;
  overconfidence: number | null;
}

export interface TradeBehaviourStats {
  missedOpportunities: number;
  prematureExits: number;
  losingExits: number;
  heldTooLong: number;
  drawdownEvents: number;
}

/** Primary scoreboard — coherent paper trades only. */
export interface TradingPerformance {
  realisedPnlUsd: number;
  /** Mid→mid before costs. Older reports may omit this. */
  grossPnlUsd?: number;
  returnOnCapital: number | null;
  trades: number;
  winRate: number | null;
  avgTradePnlUsd?: number | null;
  avgProfitPerTrade: number | null;
  avgLossPerTrade: number | null;
  profitFactor: number | null;
  largestWinnerUsd?: number | null;
  largestLoserUsd?: number | null;
  maxDrawdownUsd: number;
  avgHoldingMinutes: number | null;
  avgMfeUsd: number | null;
  avgMaeUsd: number | null;
  riskAdjustedReturn: number | null;
  behaviour: TradeBehaviourStats;
}

export interface TradeConditions {
  yesPriceUsd: number;
  noPriceUsd: number;
  liquidityScore: number;
  hoursToClose: number | null;
  hadOrderbook: boolean;
  change5m: number | null;
  volatility: number | null;
}

/** One coherent paper trade from the fitness report. */
export interface CompletedFitnessTrade {
  marketId: string;
  owner: string;
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
  swarmStateAtEntry: {
    recommendation: 'buy_yes' | 'buy_no' | 'hold';
    confidence: number;
    approved: boolean;
    signals: Array<{ agent: string; stance: string; confidence: number }>;
  };
  /** Contextual only — not used for P&L. */
  resolvedTo: 'yes' | 'no' | null;
  /** Phase 6 weights published when the position opened, if any. */
  adaptiveWeightsAtEntry: Record<string, number> | null;
}

export interface RegimeFitness {
  dimension: 'liquidity' | 'time_to_close' | 'market_conviction' | 'orderbook';
  bucket: string;
  description: string;
  stats: StanceStats;
  trading: TradingPerformance | null;
}

export interface SuggestedWeight {
  weight: number;
  reliable: boolean;
  sampleSize: number;
  rationale: string;
}

export interface AgentFitness {
  agent: string;
  trading: TradingPerformance;
  forecasting: StanceStats;
  /** @deprecated Prefer forecasting — kept for older responses. */
  overall: StanceStats;
  bySource: Array<{ source: FitnessSource; stats: StanceStats }>;
  calibration: CalibrationBucket[];
  regimes: RegimeFitness[];
  weight: SuggestedWeight;
  /** Coherent paper trades — may be missing on older in-memory reports. */
  trades?: CompletedFitnessTrade[];
}

export interface HeadToHead {
  agentA: string;
  agentB: string;
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
  agents: string[];
  note: string;
}

export interface FitnessOptions {
  includeLiveRuns: boolean;
  maxRuns: number;
  minSampleForWeight: number;
  specialistStakeUsd: number;
  backtest: {
    maxMarkets: number;
    decisionIntervalMinutes: number;
    exitHoldMinutes: number;
    minSnapshots: number;
    maxSnapshotsPerMarket: number;
    requireOrderbook: boolean;
    minConfidence: number;
  };
}

export interface FitnessReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  options: FitnessOptions;
  sources: SourceSummary[];
  gradedStances: number;
  completedTrades: number;
  marketsCovered: number;
  swarm: TradingPerformance;
  /** Swarm coherent trades — may be missing on older in-memory reports. */
  swarmTrades?: CompletedFitnessTrade[];
  agents: AgentFitness[];
  headToHead: HeadToHead[];
  skipped: Array<{ marketId: string; reason: string }>;
  warnings: string[];
}

/** Phase 6 adaptive weight row — inspectable evidence behind influence. */
export interface AdaptiveAgentWeight {
  agent: string;
  currentWeight: number;
  baselineWeight: number;
  sampleCount: number;
  recentSampleCount: number;
  recentPnlUsd: number;
  longTermPnlUsd: number;
  drawdownUsd: number;
  evidenceLevel: 'none' | 'low' | 'moderate' | 'high';
  overallFitness: number;
  recentFitness: number;
  confidenceAdjustedFitness: number;
  consistency: number;
  effectiveFitness: number;
  rationale: string;
  regime?: {
    dimension: string;
    bucket: string;
    sampleCount: number;
    fitness: number;
    realisedPnlUsd: number;
  } | null;
}

export interface AdaptiveWeightTable {
  computedAt: string;
  sourceFitnessAt: string | null;
  baselineWeight: number;
  warnings: string[];
  agents: AdaptiveAgentWeight[];
}

export interface FitnessStatus {
  running: boolean;
  defaults: FitnessOptions;
  resolvedMarkets: number;
  labelledMarkets: number;
  lastRun: FitnessReport | null;
  /** Phase 6 weights published after the last fitness or live-paper refresh. */
  adaptive?: AdaptiveWeightTable | null;
}
