import type { JupiterMarketDetail, JupiterOrderbook } from '../jupiter/types.js';

/** Input passed when invoking the market analysis graph. */
export interface MarketAnalysisInput {
  marketId: string;
}

/** Final output from the reasoning pipeline. */
export interface MarketAnalysisResult {
  marketId: string;
  yesLikelihood: number;
  reasoning: string;
  technicalAnalysis: string;
  semanticAnalysis: string;
  analyzedAt: string;
}

/** Shared state carried between LangGraph nodes. */
export interface AgentState {
  marketId: string;
  market: JupiterMarketDetail | null;
  orderbook: JupiterOrderbook | null;
  technicalAnalysis: string | null;
  semanticAnalysis: string | null;
  yesLikelihood: number | null;
  reasoning: string | null;
  errors: string[];
}
