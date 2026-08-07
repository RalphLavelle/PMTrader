/** Types for the Phase 4 backtest dashboard — mirror /api/backtest responses. */

export interface BacktestOptions {
  maxMarkets: number;
  decisionIntervalMinutes: number;
  minSnapshots: number;
  maxSnapshotsPerMarket: number;
  requireOrderbook: boolean;
  minConfidence: number;
}

/** Headline statistics for a set of graded decisions. */
export interface PerformanceStats {
  decisions: number;
  directionalDecisions: number;
  holdDecisions: number;
  correctDecisions: number;
  incorrectDecisions: number;
  accuracy: number | null;
  totalStakedUsd: number;
  totalPnlUsd: number;
  returnOnStake: number | null;
  unscorable: number;
}

/** One band of the "when we said 70%, how often was it YES?" curve. */
export interface CalibrationBucket {
  lowerBound: number;
  upperBound: number;
  decisions: number;
  meanPredicted: number;
  observedYesRate: number;
}

export interface MarketBacktestResult {
  marketId: string;
  title: string;
  result: 'yes' | 'no';
  firstDecisionAt: string;
  lastDecisionAt: string;
  stats: PerformanceStats;
}

export interface SkippedMarket {
  marketId: string;
  reason: string;
}

/** How often one Risk Manager veto stopped a decision becoming a bet. */
export interface VetoTally {
  reason: string;
  decisions: number;
}

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
  agents: string[];
  marketsConsidered: number;
  marketsEvaluated: number;
  skipped: SkippedMarket[];
  decisionsWithOrderbook: number;
  strategy: PerformanceStats;
  baseline: PerformanceStats;
  calibration: CalibrationBucket[];
  vetoes: VetoTally[];
  markets: MarketBacktestResult[];
}

export interface BacktestStatus {
  running: boolean;
  defaults: BacktestOptions;
  resolvedMarkets: number;
  labelledMarkets: number;
  nextMarkets: Array<{
    marketId: string;
    title: string;
    result: 'yes' | 'no';
    snapshotCount: number;
    orderbookCount: number;
  }>;
  lastRun: BacktestSummary | null;
}
