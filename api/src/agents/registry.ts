import type { LanguageModelLike } from '@langchain/core/language_models/base';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { createHandoffTool } from '@langchain/langgraph-swarm';
import type { AgentName } from '../schemas/index.js';
import { AgentAnalysisState } from '../swarm/state.js';
import {
  assessRiskTool,
  evaluateMeanReversionTool,
  evaluateSemanticTool,
  evaluateTrendTool,
  prepareMarketDataTool,
} from '../swarm/tools/index.js';
import { AGENT_DESCRIPTIONS, AGENT_NAMES } from './names.js';
import {
  MARKET_ANALYST_PROMPT,
  MEAN_REVERSION_AGENT_PROMPT,
  RISK_MANAGER_PROMPT,
  SEMANTIC_AGENT_PROMPT,
  TREND_AGENT_PROMPT,
} from './prompts.js';

/**
 * Declarative description of every agent in the swarm.
 *
 * Adding a future specialist — Portfolio Manager, Execution Agent, Volatility
 * Agent, Learning Agent, Regime Detection Agent — means writing its pure logic,
 * wrapping it in a tool, and appending one entry here. No orchestration code
 * changes, because the swarm is assembled from this table.
 */
export interface SwarmAgentSpec {
  /** Used verbatim as the LangGraph node name. */
  name: AgentName;
  /** System prompt, imported from the prompts module rather than inlined. */
  prompt: string;
  /** Domain tools that run this agent's business logic. */
  tools: StructuredToolInterface[];
  /**
   * Agents this one may hand control to.
   *
   * There is no supervisor: routing emerges from these edges plus each agent's
   * prompt. Most agents can reach the Risk Manager directly so that a run can
   * always terminate, even if an earlier step failed.
   */
  handoffTargets: AgentName[];
}

export const AGENT_SPECS: readonly SwarmAgentSpec[] = [
  {
    name: AGENT_NAMES.marketAnalyst,
    prompt: MARKET_ANALYST_PROMPT,
    tools: [prepareMarketDataTool],
    handoffTargets: [AGENT_NAMES.trend, AGENT_NAMES.semantic],
  },
  {
    name: AGENT_NAMES.trend,
    prompt: TREND_AGENT_PROMPT,
    tools: [evaluateTrendTool],
    handoffTargets: [AGENT_NAMES.meanReversion, AGENT_NAMES.riskManager],
  },
  {
    name: AGENT_NAMES.meanReversion,
    prompt: MEAN_REVERSION_AGENT_PROMPT,
    tools: [evaluateMeanReversionTool],
    handoffTargets: [AGENT_NAMES.semantic, AGENT_NAMES.riskManager],
  },
  {
    name: AGENT_NAMES.semantic,
    prompt: SEMANTIC_AGENT_PROMPT,
    tools: [evaluateSemanticTool],
    handoffTargets: [AGENT_NAMES.riskManager, AGENT_NAMES.trend],
  },
  {
    name: AGENT_NAMES.riskManager,
    prompt: RISK_MANAGER_PROMPT,
    // The Risk Manager can send work back only when data is missing; it has no
    // forward edge, which is what makes it the natural end of a run.
    tools: [assessRiskTool],
    handoffTargets: [AGENT_NAMES.marketAnalyst],
  },
];

/** A compiled agent, as produced by `createReactAgent`. */
export type CompiledSwarmAgent = ReturnType<typeof createReactAgent>;

/**
 * Build one agent from its spec.
 *
 * Every agent shares `AgentAnalysisState` so that snapshots, signals, and the
 * final recommendation propagate between them through the swarm's shared state.
 */
export function buildAgent(spec: SwarmAgentSpec, llm: LanguageModelLike): CompiledSwarmAgent {
  const handoffTools = spec.handoffTargets.map((target) =>
    createHandoffTool({
      agentName: target,
      description: AGENT_DESCRIPTIONS[target],
    }),
  );

  return createReactAgent({
    llm,
    name: spec.name,
    prompt: spec.prompt,
    stateSchema: AgentAnalysisState,
    tools: [...spec.tools, ...handoffTools] as StructuredToolInterface[],
  });
}

/** Build every agent in the swarm, in registry order. */
export function buildSwarmAgents(llm: LanguageModelLike): CompiledSwarmAgent[] {
  return AGENT_SPECS.map((spec) => buildAgent(spec, llm));
}
