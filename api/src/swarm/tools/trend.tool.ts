import { tool } from '@langchain/core/tools';
import type { ToolRunnableConfig } from '@langchain/core/tools';
import { z } from 'zod';
import { evaluateTrend } from '../../agents/trend/logic.js';
import { readAgentState, recordToolError, recordToolResult } from './shared.js';

/**
 * Trend Agent tool: run the trend-following model over the prepared snapshot.
 *
 * The scoring itself lives in `agents/trend/logic.ts`; this wrapper only reads
 * state, calls that function, and records the structured signal it returns.
 */
export const evaluateTrendTool = tool(
  async (_args: Record<string, never>, config: ToolRunnableConfig) => {
    const { snapshot, features } = readAgentState();

    if (!snapshot || !features) {
      return recordToolError(
        config,
        'Market data has not been prepared yet, so no trend signal can be produced.',
      );
    }

    const signal = evaluateTrend(snapshot, features);
    const summary =
      `Trend signal: ${signal.stance.toUpperCase()} at confidence ` +
      `${signal.confidence.toFixed(2)}. ${signal.reasoning}`;

    return recordToolResult(config, summary, { signals: [signal] });
  },
  {
    name: 'evaluate_trend',
    description:
      'Score a trend-following opportunity from the prepared market features and record a structured signal.',
    schema: z.object({}),
  },
);
