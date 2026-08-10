/**
 * Phase 5 agent fitness — public surface.
 *
 * Primary: coherent intramarket paper trades (swarm + per-specialist books).
 * Secondary: resolution / Brier forecasting diagnostics.
 *
 * Nothing here writes to MongoDB: a fitness report is recomputed on demand.
 */
export { summariseBehaviour } from './behaviour.js';
export { resolveFitnessOptions, runFitness } from './engine.js';
export { buildHeadToHead } from './disagreement.js';
export {
  beatsCoinFlip,
  brier,
  buildStanceCalibration,
  stanceWasCorrect,
  stanceWasProfitable,
  suggestWeight,
  summariseStances,
} from './metrics.js';
export { summariseRegimes } from './regimes.js';
export { getLastFitness, isFitnessRunning, runFitnessOnce } from './runner.js';
export {
  decisionKey,
  gradeStanceTrade,
  marketImpliedYes,
  stancesFromDecision,
  stancesFromRun,
} from './stances.js';
export {
  collectFitnessTrades,
  proposeFromStance,
  simulateSpecialistTrades,
  swarmTradesFromHistory,
} from './trades.js';
export {
  countDrawdownEvents,
  emptyTradingPerformance,
  entryImpliedYes,
  maxDrawdownUsd,
  summariseTrades,
  tradeMatchesRegime,
} from './trading-metrics.js';
export { buildWarnings } from './warnings.js';
export type {
  AgentFitness,
  CompletedFitnessTrade,
  FitnessOptions,
  FitnessReport,
  FitnessSource,
  GradedStance,
  HeadToHead,
  RegimeDimension,
  RegimeFitness,
  SourceSummary,
  StanceStats,
  SuggestedWeight,
  TradeBehaviourStats,
  TradeConditions,
  TradeOwner,
  TradingPerformance,
} from './types.js';
