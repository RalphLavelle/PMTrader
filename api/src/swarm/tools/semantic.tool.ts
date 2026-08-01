import { tool } from '@langchain/core/tools';
import type { ToolRunnableConfig } from '@langchain/core/tools';
import { z } from 'zod';
import { evaluateSemantic } from '../../agents/semantic/logic.js';
import { readAgentState, recordToolError, recordToolResult } from './shared.js';

/**
 * Semantic Agent tool: real-world reasoning over the market question.
 *
 * Unlike the trend and mean-reversion tools this one calls a language model,
 * because judging what a resolution rule means is exactly the kind of work that
 * has no deterministic implementation.
 */
export const evaluateSemanticTool = tool(
  async (_args: Record<string, never>, config: ToolRunnableConfig) => {
    const { snapshot } = readAgentState();

    if (!snapshot) {
      return recordToolError(
        config,
        'Market data has not been prepared yet, so no semantic signal can be produced.',
      );
    }

    const signal = await evaluateSemantic(snapshot);
    const summary =
      `Semantic signal: ${signal.stance.toUpperCase()} at confidence ` +
      `${signal.confidence.toFixed(2)}. ${signal.reasoning}`;

    return recordToolResult(config, summary, { signals: [signal] });
  },
  {
    name: 'evaluate_semantic',
    description:
      'Run the existing semantic analysis chain over the market rules and record a structured real-world signal.',
    schema: z.object({}),
  },
);
