/**
 * Public surface of the agent layer.
 *
 * Business logic is exported alongside the agent definitions so it can be called
 * directly — by unit tests, and by the deterministic runner that executes the
 * same models in a fixed order when no language model is configured.
 */
export { AGENT_NAMES, AGENT_DESCRIPTIONS, DEFAULT_ACTIVE_AGENT } from './names.js';
export {
  agentMarketsFilePath,
  loadAgentMarketIds,
  type AgentMarketsFile,
} from './markets.js';
export {
  AGENT_SPECS,
  buildAgent,
  buildSwarmAgents,
  type CompiledSwarmAgent,
  type SwarmAgentSpec,
} from './registry.js';

export {
  buildMarketSnapshot,
  deriveFeatures,
  summariseDepth,
  toUsdPrice,
} from './market-analyst/logic.js';
export { evaluateTrend } from './trend/logic.js';
export { evaluateMeanReversion } from './mean-reversion/logic.js';
export { evaluateSemantic } from './semantic/logic.js';
export { aggregateSignals, agentInfluence, signalInfluence, signalToYesProbability } from './risk-manager/aggregate.js';
export { configuredRiskLimits } from './risk-manager/limits.js';
export { assessRisk, buildRecommendation, type RiskLimits } from './risk-manager/logic.js';
