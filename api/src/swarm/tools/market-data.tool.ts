import { tool } from '@langchain/core/tools';
import type { ToolRunnableConfig } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchMarketContext } from '../pipeline.js';
import { recordToolError, recordToolResult, readAgentState } from './shared.js';

/**
 * Market Analyst tool: fetch Jupiter data, join collector history as-of now,
 * and write the canonical MarketContext into swarm state.
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
      const { snapshot, features, context } = await fetchMarketContext(state.marketId);

      const summary = [
        `Market "${snapshot.title}" (${snapshot.status}).`,
        `Implied yes ${(features.impliedYesProbability * 100).toFixed(1)}%,`,
        `liquidity ${features.liquidityScore.toFixed(2)},`,
        `depth imbalance ${features.depthImbalance.toFixed(2)},`,
        context.trajectory.change5m === null
          ? '5m change n/a,'
          : `5m change ${(context.trajectory.change5m * 100).toFixed(2)}pp,`,
        context.meta.historyPoints > 1
          ? `${context.meta.historyPoints} history points,`
          : 'live tip only (no prior history),',
        features.hoursToClose === null
          ? 'close time unknown.'
          : `${features.hoursToClose.toFixed(1)}h to close.`,
      ].join(' ');

      return recordToolResult(config, summary, {
        snapshot,
        features,
        marketContext: context,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch market data.';
      return recordToolError(config, message);
    }
  },
  {
    name: 'prepare_market_data',
    description:
      'Fetch the market and orderbook from Jupiter, join collector history as-of now, and compute the canonical market context. Call this once before any analysis.',
    schema: z.object({}),
  },
);
