import { END, START, StateGraph } from '@langchain/langgraph';
import { fetchMarketNode } from './nodes/fetch-market.js';
import { semanticAnalysisNode } from './nodes/semantic-analysis.js';
import { synthesizeNode } from './nodes/synthesize.js';
import { technicalAnalysisNode } from './nodes/technical-analysis.js';
import { AgentStateAnnotation } from './state.js';
import type { MarketAnalysisInput, MarketAnalysisResult } from './types.js';

/** Compiled LangGraph pipeline: fetch → technical → semantic → synthesize. */
export const marketAnalysisGraph = new StateGraph(AgentStateAnnotation)
  .addNode('fetch_market', fetchMarketNode)
  .addNode('technical_analysis', technicalAnalysisNode)
  .addNode('semantic_analysis', semanticAnalysisNode)
  .addNode('synthesize', synthesizeNode)
  .addEdge(START, 'fetch_market')
  .addEdge('fetch_market', 'technical_analysis')
  .addEdge('technical_analysis', 'semantic_analysis')
  .addEdge('semantic_analysis', 'synthesize')
  .addEdge('synthesize', END)
  .compile();

/** Run the reasoning pipeline for a single market. */
export async function runMarketAnalysis(
  input: MarketAnalysisInput,
): Promise<MarketAnalysisResult> {
  const finalState = await marketAnalysisGraph.invoke({
    marketId: input.marketId,
    market: null,
    orderbook: null,
    technicalAnalysis: null,
    semanticAnalysis: null,
    yesLikelihood: null,
    reasoning: null,
    errors: [],
  });

  if (finalState.errors.length > 0 && !finalState.market) {
    throw new Error(finalState.errors.join(' '));
  }

  return {
    marketId: input.marketId,
    yesLikelihood: finalState.yesLikelihood ?? 0.5,
    reasoning: finalState.reasoning ?? 'Analysis did not produce reasoning.',
    technicalAnalysis: finalState.technicalAnalysis ?? '',
    semanticAnalysis: finalState.semanticAnalysis ?? '',
    analyzedAt: new Date().toISOString(),
  };
}
