import { Annotation, MessagesAnnotation } from '@langchain/langgraph';
import { SwarmState } from '@langchain/langgraph-swarm';
import type { MarketContext } from '../features/context.js';
import type {
  AgentSignal,
  DerivedFeatures,
  MarketSnapshot,
  RiskAssessment,
  SwarmRecommendation,
} from '../schemas/index.js';

/**
 * Shared state for the trading swarm.
 *
 * LangGraph state is organised into "channels". Each channel declares a reducer
 * (how two writes are combined) and a default. Because agents run as subgraphs
 * inside the swarm, any channel declared on *both* the agent and the swarm is
 * copied between them automatically — that is how a signal written by the Trend
 * Agent becomes visible to the Risk Manager without a supervisor passing it along.
 */

/** Keep only the newest write. Used for values that are computed once. */
function replace<T>(_current: T, incoming: T): T {
  return incoming;
}

/**
 * Merge signals so each agent contributes at most one.
 *
 * A re-run (for example when the Risk Manager sends work back for more data)
 * should update that agent's opinion rather than append a duplicate.
 */
function mergeSignals(current: AgentSignal[], incoming: AgentSignal[]): AgentSignal[] {
  const byAgent = new Map(current.map((signal) => [signal.agent, signal]));
  for (const signal of incoming) {
    byAgent.set(signal.agent, signal);
  }
  return [...byAgent.values()];
}

/**
 * The analysis-specific channels, defined once and spread into both the swarm
 * state and each agent's state so the two schemas cannot drift apart.
 */
export const analysisChannels = {
  /** The market under analysis; supplied when the run is started. */
  marketId: Annotation<string>({ reducer: replace, default: () => '' }),
  /** Normalised market data, written by the Market Analyst. */
  snapshot: Annotation<MarketSnapshot | null>({ reducer: replace, default: () => null }),
  /** Quantitative features, written by the Market Analyst. */
  features: Annotation<DerivedFeatures | null>({ reducer: replace, default: () => null }),
  /** Canonical as-of-T context (history + live tip), written with market data. */
  marketContext: Annotation<MarketContext | null>({ reducer: replace, default: () => null }),
  /** One structured opinion per specialist agent. */
  signals: Annotation<AgentSignal[]>({ reducer: mergeSignals, default: () => [] }),
  /** Written only by the Risk Manager. */
  riskAssessment: Annotation<RiskAssessment | null>({ reducer: replace, default: () => null }),
  /** The swarm's final answer, written only by the Risk Manager. */
  recommendation: Annotation<SwarmRecommendation | null>({ reducer: replace, default: () => null }),
  /** Non-fatal problems collected across the run, for diagnostics. */
  errors: Annotation<string[]>({
    reducer: (current: string[], incoming: string[]) => current.concat(incoming),
    default: () => [],
  }),
};

/**
 * State schema for the swarm graph itself.
 *
 * `SwarmState.spec` contributes `messages` plus the `activeAgent` channel the
 * swarm uses to remember who spoke last. `activeAgent` is mandatory —
 * `createSwarm` throws if it is missing.
 */
export const SwarmAnalysisState = Annotation.Root({
  ...SwarmState.spec,
  ...analysisChannels,
});

/**
 * State schema for each individual agent.
 *
 * Agents share the `messages` channel, so the whole swarm sees one continuous
 * conversation, and they share the analysis channels so results propagate.
 */
export const AgentAnalysisState = Annotation.Root({
  ...MessagesAnnotation.spec,
  ...analysisChannels,
});

export type SwarmAnalysisStateType = typeof SwarmAnalysisState.State;
export type AgentAnalysisStateType = typeof AgentAnalysisState.State;
