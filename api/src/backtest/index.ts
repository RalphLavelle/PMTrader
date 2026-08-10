/**
 * Phase 4 offline evaluation — public surface.
 *
 * Replays stored market history through the swarm's own decision logic and
 * grades intramarket entry→exit trades. Resolution labels are optional context.
 * Nothing here writes to MongoDB: a backtest is a derived view, recomputed on demand.
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
export { getLastBacktest, getLastPaperReplay, isBacktestRunning, runBacktestOnce, runPaperReplayOnce } from './runner.js';
export {
  paperReplayMarket,
  paperReplaySingleMarket,
  resolvePaperOptions,
  runPaperReplay,
} from './paper-engine.js';
export type {
  ClosedPaperTrade,
  PaperDecisionRecord,
  PaperMarketHistory,
  PaperReplayOptions,
  PaperReplaySummary,
  PaperTradeConditions,
} from './paper-types.js';
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
