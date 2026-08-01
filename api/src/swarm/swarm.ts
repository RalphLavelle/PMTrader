import type { LanguageModelLike } from '@langchain/core/language_models/base';
import { createSwarm } from '@langchain/langgraph-swarm';
import { buildSwarmAgents, DEFAULT_ACTIVE_AGENT } from '../agents/index.js';
import { SwarmAnalysisState } from './state.js';

/** The element type `createSwarm` expects in its `agents` array. */
type SwarmAgentInput = Parameters<typeof createSwarm>[0]['agents'][number];

/**
 * Assemble the multi-agent trading swarm.
 *
 * There is no supervisor node. Control moves between agents purely through the
 * handoff tools declared in the agent registry, and the swarm records who spoke
 * last in its `activeAgent` channel.
 */
export function createTradingSwarm(llm: LanguageModelLike) {
  const agents = buildSwarmAgents(llm);

  const workflow = createSwarm({
    // Each agent declares the analysis channels in its own state schema, which
    // the published `createSwarm` types do not model — they hardcode a
    // messages-only agent shape. The cast is a workaround for that declaration
    // gap; the values are exactly what the function expects at runtime.
    agents: agents as unknown as SwarmAgentInput[],
    defaultActiveAgent: DEFAULT_ACTIVE_AGENT,
    stateSchema: SwarmAnalysisState,
  });

  // Compiled without a checkpointer on purpose: each analysis is a single-shot
  // run rather than a multi-turn conversation, so persisting every thread would
  // grow memory without ever being read. Durable history lives in the memory
  // store instead, which is queryable and swappable.
  return workflow.compile();
}

export type TradingSwarm = ReturnType<typeof createTradingSwarm>;

/** Cached swarm so the graph is compiled once rather than per request. */
let cachedSwarm: TradingSwarm | null = null;

/** Return the shared swarm, compiling it on first use. */
export function getTradingSwarm(llm: LanguageModelLike): TradingSwarm {
  cachedSwarm ??= createTradingSwarm(llm);
  return cachedSwarm;
}

/** Drop the cached swarm. Used by tests that swap the model. */
export function resetTradingSwarm(): void {
  cachedSwarm = null;
}
