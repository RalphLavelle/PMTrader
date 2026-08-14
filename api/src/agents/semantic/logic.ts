import { z } from 'zod';
import { createChatModel } from '../../llm/index.js';
import { parseLlmJson } from '../../llm/parse-json.js';
import { noteLlmFailure } from '../../llm/quota.js';
import { generateSemanticNarrative } from '../../semantic/narrative.js';
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
 * Produces a real-world research narrative, then converts it into a structured
 * signal the Risk Manager can consume. Without an API key both steps degrade to
 * a neutral signal, matching how the rest of the codebase behaves when unconfigured.
 */

/** Structured verdict extracted from the semantic narrative. */
const semanticVerdictSchema = z.object({
  stance: stanceSchema,
  confidence: confidenceSchema,
  reasoning: z.string().min(1),
});

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
  const narrative = await generateSemanticNarrative({
    title: snapshot.title,
    status: snapshot.status,
    rulesPrimary: snapshot.rulesPrimary,
    rulesSecondary: snapshot.rulesSecondary,
  });
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
    const messages = [
      { role: 'system' as const, content: SEMANTIC_VERDICT_PROMPT },
      {
        role: 'user' as const,
        content: JSON.stringify({
          title: snapshot.title,
          status: snapshot.status,
          rulesPrimary: snapshot.rulesPrimary,
          rulesSecondary: snapshot.rulesSecondary,
          narrative,
        }),
      },
    ];

    // Ollama models often ignore OpenAI-style structured output and return fenced
    // JSON instead, so parse the response manually after a plain invoke.
    const response = await model.invoke(messages);
    const content = typeof response.content === 'string' ? response.content : '';
    const verdict = parseLlmJson(content, (value) => semanticVerdictSchema.parse(value));

    return agentSignalSchema.parse({
      agent: AGENT_NAMES.semantic,
      stance: verdict.stance,
      confidence: verdict.confidence,
      reasoning: verdict.reasoning,
      supportingMetrics: {},
      generatedAt,
    });
  } catch (error) {
    noteLlmFailure(error);
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
