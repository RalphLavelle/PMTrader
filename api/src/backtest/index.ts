/**
 * Phase 4 offline evaluation — public surface.
 *
 * Replays stored market history through the swarm's own decision logic and
 * grades it against the outcomes the Phase 3 labeller discovered. Nothing here
 * writes to MongoDB: a backtest is a derived view, recomputed on demand.
 */
export {
  backtestMarket,
  backtestSingleMarket,
  replayResolvedMarkets,
  resolveOptions,
  runBacktest,
  type ReplayHarvest,
} from './engine.js';
export { buildDecisionPoints, reconstructSnapshot, type DecisionPoint } from './history.js';
export {
  buildCalibration,
  summariseBaseline,
  summariseStrategy,
  summariseVetoes,
  type CalibratableForecast,
} from './metrics.js';
export { REPLAY_AGENTS, replayDecision } from './replay.js';
export { scoreDecision } from './score.js';
export { getLastBacktest, isBacktestRunning, runBacktestOnce } from './runner.js';
export type {
  BacktestOptions,
  BacktestSummary,
  BaselineDecision,
  CalibrationBucket,
  MarketBacktestDetail,
  MarketBacktestResult,
  PerformanceStats,
  ReplayedDecision,
  ReplayedSignal,
  ScoredDecision,
  SkippedMarket,
  VetoTally,
} from './types.js';
