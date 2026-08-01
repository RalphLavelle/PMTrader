import { tool } from '@langchain/core/tools';
import type { ToolRunnableConfig } from '@langchain/core/tools';
import { z } from 'zod';
import { evaluateMeanReversion } from '../../agents/mean-reversion/logic.js';
import { readAgentState, recordToolError, recordToolResult } from './shared.js';

/**
 * Mean Reversion Agent tool: run the reversal model over the prepared snapshot.
 *
 * Mirrors the trend tool exactly, which is intentional — the two strategies must
 * see identical inputs for their disagreement to carry information.
 */
export const evaluateMeanReversionTool = tool(
  async (_args: Record<string, never>, config: ToolRunnableConfig) => {
    const { snapshot, features } = readAgentState();

    if (!snapshot || !features) {
      return recordToolError(
        config,
        'Market data has not been prepared yet, so no mean-reversion signal can be produced.',
      );
    }

    const signal = evaluateMeanReversion(snapshot, features);
    const summary =
      `Mean-reversion signal: ${signal.stance.toUpperCase()} at confidence ` +
      `${signal.confidence.toFixed(2)}. ${signal.reasoning}`;

    return recordToolResult(config, summary, { signals: [signal] });
  },
  {
    name: 'evaluate_mean_reversion',
    description:
      'Score a mean-reversion opportunity from the prepared market features and record a structured signal.',
    schema: z.object({}),
  },
);
