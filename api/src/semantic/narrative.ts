import { createChatModel } from '../llm/index.js';
import { SEMANTIC_NARRATIVE_PROMPT } from '../agents/prompts.js';

/** Market text fields used to produce a real-world research narrative. */
export interface SemanticMarketContext {
  title: string;
  status: string;
  rulesPrimary?: string | null;
  rulesSecondary?: string | null;
}

/**
 * Summarise what real-world evidence would matter for a prediction market.
 *
 * When no language model is configured, returns a scaffold narrative built from
 * the title, status, and resolution rules excerpt.
 */
export async function generateSemanticNarrative(
  context: SemanticMarketContext,
): Promise<string> {
  const model = createChatModel();
  const { title, rulesPrimary, rulesSecondary, status } = context;

  if (model) {
    const response = await model.invoke([
      { role: 'system', content: SEMANTIC_NARRATIVE_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({ title, rulesPrimary, rulesSecondary, status }),
      },
    ]);

    const content = typeof response.content === 'string' ? response.content : '';
    return content || 'No semantic summary returned.';
  }

  const rulesSnippet = rulesPrimary?.slice(0, 120) ?? 'No rules published yet.';

  return [
    `Scaffold semantic pass for "${title}" (${status}).`,
    `Resolution rules excerpt: ${rulesSnippet}`,
  ].join(' ');
}
