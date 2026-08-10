/**
 * Phase 6 adaptive weighting — public surface.
 *
 * Deterministic, inspectable influence multipliers derived from coherent
 * paper-trade fitness. Consumed by signal aggregation; never touches LLM prompts.
 */
export {
  getAdaptiveTable,
  getAdaptiveTrades,
  getAgentWeightMap,
  refreshAdaptiveFromFitness,
  refreshAdaptiveFromLiveTrades,
  setAdaptiveTable,
  weightsForRegime,
} from './store.js';
export { classifyRegime, bestRegimeSlice } from './regime.js';
export {
  consistencyScore,
  meanEntryConfidence,
  meanReturnOnCapital,
  recentTrades,
  returnStdev,
  scoreTradeSet,
  shrunkWinRate,
  sortChronological,
} from './score.js';
export {
  blendFitness,
  buildAdaptiveWeightTable,
  buildAgentWeight,
  evidenceLevel,
  resolveAdaptiveOptions,
  toWeightMap,
} from './weights.js';
export {
  BASELINE_WEIGHT,
  WEIGHT_CEILING,
  WEIGHT_FLOOR,
  type AdaptiveAgentWeight,
  type AdaptiveBuildInput,
  type AdaptiveOptions,
  type AdaptiveWeightTable,
  type AgentWeightMap,
  type EvidenceLevel,
  type RegimeContext,
  type RegimeWeightSlice,
} from './types.js';
