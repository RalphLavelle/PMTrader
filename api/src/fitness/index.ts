/**
 * Phase 5 agent fitness — public surface.
 *
 * Grades each specialist's stance against markets that have already resolved,
 * rather than grading the blended recommendation the way Phase 4 did. The
 * output is a suggested confidence weight per agent, which Phase 6's adaptive
 * Risk Manager is meant to consume.
 *
 * Nothing here writes to MongoDB: a fitness report is recomputed on demand.
 */
export { resolveFitnessOptions, runFitness } from './engine.js';
export { buildHeadToHead } from './disagreement.js';
export {
  beatsCoinFlip,
  brier,
  buildStanceCalibration,
  stanceWasCorrect,
  suggestWeight,
  summariseStances,
} from './metrics.js';
export { summariseRegimes } from './regimes.js';
export { getLastFitness, isFitnessRunning, runFitnessOnce } from './runner.js';
export { decisionKey, marketImpliedYes, stancesFromDecision, stancesFromRun } from './stances.js';
export { buildWarnings } from './warnings.js';
export type {
  AgentFitness,
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
} from './types.js';
