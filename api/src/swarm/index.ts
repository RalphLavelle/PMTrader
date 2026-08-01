/**
 * Public surface of the swarm orchestration layer.
 *
 * Callers (routes, schedulers, tests) should import from here rather than
 * reaching into individual modules, so the internal layout stays free to change.
 */
export { runSwarmAnalysis, type RunSwarmAnalysisOptions } from './runner.js';
export {
  finaliseAnalysis,
  runDeterministicPipeline,
  type AnalysisOutputs,
} from './pipeline.js';
export { buildAnalysisRecord, type AnalysisRecordInput } from './record.js';
export {
  createTradingSwarm,
  getTradingSwarm,
  resetTradingSwarm,
  type TradingSwarm,
} from './swarm.js';
export {
  AgentAnalysisState,
  SwarmAnalysisState,
  analysisChannels,
  type AgentAnalysisStateType,
  type SwarmAnalysisStateType,
} from './state.js';
