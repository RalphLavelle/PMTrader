import { tool } from '@langchain/core/tools';
import type { ToolRunnableConfig } from '@langchain/core/tools';
import { z } from 'zod';
import { buildMarketSnapshot, deriveFeatures } from '../../agents/market-analyst/logic.js';
import { jupiter } from '../../jupiter/index.js';
import { readAgentState, recordToolError, recordToolResult } from './shared.js';

/**
 * Market Analyst tool: fetch Jupiter data and compute derived features.
 *
 * This is the only tool that performs network I/O. Every other agent works from
 * the snapshot it writes, which guarantees all specialists reason over exactly
 * the same numbers captured at the same moment.
 */
export const prepareMarketDataTool = tool(
  async (_args: Record<string, never>, config: ToolRunnableConfig) => {
    const state = readAgentState();

    if (!state.marketId) {
      return recordToolError(config, 'No marketId was supplied to the swarm run.');
    }

    try {
      const [market, orderbook] = await Promise.all([
        jupiter.getMarket(state.marketId),
        jupiter.getOrderbook(state.marketId),
      ]);

      const snapshot = buildMarketSnapshot(market, orderbook);
      const features = deriveFeatures(snapshot);

      const summary = [
        `Market "${snapshot.title}" (${snapshot.status}).`,
        `Implied yes ${(features.impliedYesProbability * 100).toFixed(1)}%,`,
        `liquidity ${features.liquidityScore.toFixed(2)},`,
        `depth imbalance ${features.depthImbalance.toFixed(2)},`,
        features.hoursToClose === null
          ? 'close time unknown.'
          : `${features.hoursToClose.toFixed(1)}h to close.`,
      ].join(' ');

      return recordToolResult(config, summary, { snapshot, features });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch market data.';
      return recordToolError(config, message);
    }
  },
  {
    name: 'prepare_market_data',
    description:
      'Fetch the market and orderbook from Jupiter and compute derived features. Call this once before any analysis.',
    schema: z.object({}),
  },
);
