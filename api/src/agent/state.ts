import { Annotation } from '@langchain/langgraph';
import type { JupiterMarketDetail, JupiterOrderbook } from '../jupiter/types.js';

/** LangGraph state channels for the market analysis pipeline. */
export const AgentStateAnnotation = Annotation.Root({
  marketId: Annotation<string>,
  market: Annotation<JupiterMarketDetail | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  orderbook: Annotation<JupiterOrderbook | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  technicalAnalysis: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  semanticAnalysis: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  yesLikelihood: Annotation<number | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  reasoning: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  errors: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

export type AgentGraphState = typeof AgentStateAnnotation.State;
