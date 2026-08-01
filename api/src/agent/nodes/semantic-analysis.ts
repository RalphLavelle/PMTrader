import { createChatModel } from '../llm.js';
import type { AgentGraphState } from '../state.js';

/** Real-world / semantic pass over title and resolution rules (placeholder until full logic). */
export async function semanticAnalysisNode(
  state: AgentGraphState,
): Promise<Partial<AgentGraphState>> {
  if (!state.market) {
    return { errors: ['Semantic analysis skipped — market data is missing.'] };
  }

  const model = createChatModel();
  const { title, rulesPrimary, rulesSecondary, status } = state.market;

  if (model) {
    const response = await model.invoke([
      {
        role: 'system',
        content:
          'You are a research analyst. Summarize what real-world evidence would matter for this market in 2-3 sentences.',
      },
      {
        role: 'user',
        content: JSON.stringify({ title, rulesPrimary, rulesSecondary, status }),
      },
    ]);

    const content = typeof response.content === 'string' ? response.content : '';
    return { semanticAnalysis: content || 'No semantic summary returned.' };
  }

  const rulesSnippet = rulesPrimary?.slice(0, 120) ?? 'No rules published yet.';

  return {
    semanticAnalysis: [
      `Scaffold semantic pass for "${title}" (${status}).`,
      `Resolution rules excerpt: ${rulesSnippet}`,
    ].join(' '),
  };
}
