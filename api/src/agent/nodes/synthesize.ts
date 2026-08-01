import { createChatModel } from '../llm.js';
import type { AgentGraphState } from '../state.js';

/** Combines technical and semantic passes into a yes/no likelihood estimate. */
export async function synthesizeNode(
  state: AgentGraphState,
): Promise<Partial<AgentGraphState>> {
  const model = createChatModel();

  if (model) {
    const response = await model.invoke([
      {
        role: 'system',
        content:
          'Combine the technical and semantic summaries. Reply with JSON: {"yesLikelihood":0-1,"reasoning":"..."}.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          technicalAnalysis: state.technicalAnalysis,
          semanticAnalysis: state.semanticAnalysis,
        }),
      },
    ]);

    const content = typeof response.content === 'string' ? response.content : '';
    try {
      const parsed = JSON.parse(content) as {
        yesLikelihood?: number;
        reasoning?: string;
      };

      return {
        yesLikelihood: clampLikelihood(parsed.yesLikelihood ?? 0.5),
        reasoning: parsed.reasoning ?? content,
      };
    } catch {
      return {
        yesLikelihood: 0.5,
        reasoning: content || 'LLM synthesis did not return parseable JSON.',
      };
    }
  }

  const yesPrice = state.market?.pricing?.buyYesPriceUsd ?? 0.5;
  const likelihood = clampLikelihood(yesPrice);

  return {
    yesLikelihood: likelihood,
    reasoning: [
      'Scaffold synthesis — using market buy-yes price as a placeholder likelihood.',
      state.technicalAnalysis ?? '',
      state.semanticAnalysis ?? '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}

function clampLikelihood(value: number): number {
  if (Number.isNaN(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}
