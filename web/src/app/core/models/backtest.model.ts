/** Types for the Phase 4 backtest dashboard — mirror /api/backtest responses. */

export interface BacktestOptions {
  maxMarkets: number;
  decisionIntervalMinutes: number;
  exitHoldMinutes: number;
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
  profitableDecisions: number;
  unprofitableDecisions: number;
  /** Share of scorable directional bets that were profitable (primary). */
  accuracy: number | null;
  /** Share that matched eventual resolution (secondary). */
  resolutionAccuracy: number | null;
  correctDecisions: number;
  incorrectDecisions: number;
  totalStakedUsd: number;
  totalPnlUsd: number;
  returnOnStake: number | null;
  unscorable: number;
}

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
  eventTitle?: string;
  category?: string;
  result: 'yes' | 'no' | null;
  firstDecisionAt: string;
  lastDecisionAt: string;
  stats: PerformanceStats;
}

export interface SkippedMarket {
  marketId: string;
  reason: string;
}

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
  decisionsWithExit: number;
  strategy: PerformanceStats;
  baseline: PerformanceStats;
  calibration: CalibrationBucket[];
  vetoes: VetoTally[];
  markets: MarketBacktestResult[];
}

/** One market row from a chronological paper-replay batch. */
export interface PaperReplayMarketRow {
  marketId: string;
  title: string;
  eventTitle?: string;
  category?: string;
  decisions: number;
  totalRealisedPnlUsd: number;
  finalUnrealisedPnlUsd: number | null;
  resolvedTo: 'yes' | 'no' | null;
}

/** Batch result from POST /api/backtest/paper/run. */
export interface PaperReplaySummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  marketsConsidered: number;
  marketsReplayed: number;
  skipped: Array<{ marketId: string; reason: string }>;
  markets: PaperReplayMarketRow[];
  hint?: string;
}

export interface BacktestStatus {
  running: boolean;
  defaults: BacktestOptions;
  resolvedMarkets: number;
  labelledMarkets: number;
  tradableMarkets?: number;
  nextMarkets: Array<{
    marketId: string;
    title: string;
    result: 'yes' | 'no' | null;
    snapshotCount: number;
    orderbookCount: number;
  }>;
  lastRun: BacktestSummary | null;
  /** Last paper-replay batch (stateful book, gross vs net). */
  lastPaperRun?: {
    startedAt: string;
    finishedAt: string;
    marketsReplayed: number;
    markets: PaperReplayMarketRow[];
  } | null;
}
