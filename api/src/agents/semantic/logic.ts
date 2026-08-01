import { z } from 'zod';
import { semanticAnalysisNode } from '../../agent/nodes/semantic-analysis.js';
import type { AgentGraphState } from '../../agent/state.js';
import { createChatModel } from '../../agent/llm.js';
import type { JupiterMarketDetail } from '../../jupiter/types.js';
import {
  agentSignalSchema,
  confidenceSchema,
  stanceSchema,
  type AgentSignal,
  type MarketSnapshot,
} from '../../schemas/index.js';
import { AGENT_NAMES } from '../names.js';
import { SEMANTIC_VERDICT_PROMPT } from '../prompts.js';

/**
 * Semantic Agent business logic.
 *
 * This module deliberately reuses the pre-existing semantic analysis node from
 * `src/agent/` rather than reimplementing it. That original graph stays intact
 * and keeps working on its own endpoint; the swarm simply wraps it.
 *
 * The wrapped node returns prose, but the swarm's contract requires a structured
 * signal, so a second structured-output call converts the narrative into a
 * stance and confidence. Without an API key both steps degrade to a neutral
 * signal, matching how the rest of the codebase behaves when unconfigured.
 */

/** Structured verdict extracted from the semantic narrative. */
const semanticVerdictSchema = z.object({
  stance: stanceSchema,
  confidence: confidenceSchema,
  reasoning: z.string().min(1),
});

/**
 * Adapt a snapshot back into the Jupiter shape the original node expects.
 *
 * The existing node reads only `title`, `status`, `rulesPrimary` and
 * `rulesSecondary`. The remaining fields are required by the Jupiter type but
 * unused here, so they are filled with neutral values rather than invented data.
 */
function toJupiterMarketDetail(snapshot: MarketSnapshot): JupiterMarketDetail {
  return {
    marketId: snapshot.marketId,
    provider: 'jupiter',
    title: snapshot.title,
    status: snapshot.status,
    result: null,
    openTime: 0,
    closeTime: snapshot.closeTime ?? 0,
    rulesPrimary: snapshot.rulesPrimary ?? undefined,
    rulesSecondary: snapshot.rulesSecondary ?? undefined,
  };
}

/** Run the wrapped semantic node and return the narrative it produced. */
async function runWrappedSemanticNode(snapshot: MarketSnapshot): Promise<string> {
  const state: AgentGraphState = {
    marketId: snapshot.marketId,
    market: toJupiterMarketDetail(snapshot),
    orderbook: null,
    technicalAnalysis: null,
    semanticAnalysis: null,
    yesLikelihood: null,
    reasoning: null,
    errors: [],
  };

  const update = await semanticAnalysisNode(state);
  return update.semanticAnalysis ?? 'Semantic analysis produced no narrative.';
}

/**
 * Produce the Semantic Agent's structured signal for a market.
 *
 * Never throws: a failure in the LLM step falls back to a neutral signal that
 * still carries the narrative, so one flaky call cannot abort a whole swarm run.
 */
export async function evaluateSemantic(
  snapshot: MarketSnapshot,
  now: Date = new Date(),
): Promise<AgentSignal> {
  const generatedAt = now.toISOString();
  const narrative = await runWrappedSemanticNode(snapshot);
  const model = createChatModel();

  if (!model) {
    return agentSignalSchema.parse({
      agent: AGENT_NAMES.semantic,
      stance: 'neutral',
      confidence: 0,
      reasoning: `No language model configured, so no real-world view was formed. ${narrative}`,
      supportingMetrics: {},
      generatedAt,
    });
  }

  try {
    const verdict = await model
      .withStructuredOutput(semanticVerdictSchema, { name: 'semantic_verdict' })
      .invoke([
        { role: 'system', content: SEMANTIC_VERDICT_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            title: snapshot.title,
            status: snapshot.status,
            rulesPrimary: snapshot.rulesPrimary,
            rulesSecondary: snapshot.rulesSecondary,
            narrative,
          }),
        },
      ]);

    return agentSignalSchema.parse({
      agent: AGENT_NAMES.semantic,
      stance: verdict.stance,
      confidence: verdict.confidence,
      reasoning: verdict.reasoning,
      supportingMetrics: {},
      generatedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return agentSignalSchema.parse({
      agent: AGENT_NAMES.semantic,
      stance: 'neutral',
      confidence: 0,
      reasoning: `Structured semantic verdict failed (${message}). Narrative: ${narrative}`,
      supportingMetrics: {},
      generatedAt,
    });
  }
}
