import { tool } from '@langchain/core/tools';
import type { ToolRunnableConfig } from '@langchain/core/tools';
import { z } from 'zod';
import { aggregateSignals } from '../../agents/risk-manager/aggregate.js';
import { configuredRiskLimits } from '../../agents/risk-manager/limits.js';
import { assessRisk, buildRecommendation } from '../../agents/risk-manager/logic.js';
import { readAgentState, recordToolError, recordToolResult } from './shared.js';

// Re-exported so existing swarm imports keep working now that the limits live
// beside the risk rules, where the backtest can reach them without LangGraph.
export { configuredRiskLimits };

/**
 * Risk Manager tool: aggregate every signal, size the position, apply vetoes.
 *
 * This is the terminal step of a run. It is the only tool that writes the
 * `recommendation` channel, which enforces the rule that no specialist can
 * approve its own trade.
 */
export const assessRiskTool = tool(
  async (_args: Record<string, never>, config: ToolRunnableConfig) => {
    const state = readAgentState();

    if (!state.snapshot || !state.features) {
      return recordToolError(
        config,
        'Cannot assess risk before market data has been prepared.',
      );
    }

    const proposal = aggregateSignals(state.marketId, state.signals);
    const riskAssessment = assessRisk(
      proposal,
      state.snapshot,
      state.features,
      configuredRiskLimits,
    );
    const recommendation = buildRecommendation(proposal, riskAssessment);

    const summary =
      `${riskAssessment.approved ? 'APPROVED' : 'VETOED'} — ` +
      `${recommendation.recommendation} at $${recommendation.positionSizeUsd.toFixed(2)}. ` +
      recommendation.rationale;

    return recordToolResult(config, summary, { riskAssessment, recommendation });
  },
  {
    name: 'assess_risk',
    description:
      'Aggregate all agent signals, calculate position sizing, apply veto rules, and record the final recommendation.',
    schema: z.object({}),
  },
);
