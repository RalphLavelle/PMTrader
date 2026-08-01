import type { AgentName } from '../schemas/index.js';

/**
 * Canonical agent identifiers.
 *
 * These constants are the single source of truth for agent naming. They are used
 * as LangGraph node names, as `createHandoffTool({ agentName })` targets, and as
 * keys in the persisted analysis record, so defining them once prevents the
 * three from drifting apart.
 *
 * Names are `snake_case` deliberately: the swarm derives a handoff tool name by
 * lowercasing the agent name and replacing whitespace with underscores, so a
 * `snake_case` name keeps the node name and the tool suffix identical.
 */
export const AGENT_NAMES = {
  marketAnalyst: 'market_analyst',
  trend: 'trend_agent',
  meanReversion: 'mean_reversion_agent',
  semantic: 'semantic_agent',
  riskManager: 'risk_manager',
} as const satisfies Record<string, AgentName>;

/**
 * The agent the swarm starts with.
 *
 * The Market Analyst goes first because every other specialist depends on the
 * snapshot and derived features it places into shared state.
 */
export const DEFAULT_ACTIVE_AGENT: AgentName = AGENT_NAMES.marketAnalyst;

/** Short descriptions used to build handoff tool text for each target agent. */
export const AGENT_DESCRIPTIONS: Record<AgentName, string> = {
  market_analyst:
    'Fetches market data and computes derived features. Start here; it never recommends trades.',
  trend_agent: 'Evaluates trend-following opportunities and returns a structured signal.',
  mean_reversion_agent:
    'Evaluates mean-reversion (fade the crowd) opportunities and returns a structured signal.',
  semantic_agent:
    'Reasons about real-world evidence and resolution rules using the existing semantic analysis.',
  risk_manager:
    'Reviews all proposed trades, sizes the position, and can veto. Always finish here.',
};
