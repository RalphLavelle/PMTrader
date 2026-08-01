import { createChatModel } from '../llm.js';
import type { AgentGraphState } from '../state.js';

/** Data-driven pass over pricing and orderbook depth (placeholder until full logic). */
export async function technicalAnalysisNode(
  state: AgentGraphState,
): Promise<Partial<AgentGraphState>> {
  if (!state.market) {
    return { errors: ['Technical analysis skipped — market data is missing.'] };
  }

  const model = createChatModel();
  const pricing = state.market.pricing;
  const yesBidDepth = state.orderbook?.yes_dollars.length ?? 0;
  const noBidDepth = state.orderbook?.no_dollars.length ?? 0;

  if (model) {
    const response = await model.invoke([
      {
        role: 'system',
        content:
          'You are a quantitative analyst for prediction markets. Summarize orderbook and pricing signals in 2-3 sentences.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          title: state.market.title,
          pricing,
          yesBidLevels: yesBidDepth,
          noBidLevels: noBidDepth,
        }),
      },
    ]);

    const content = typeof response.content === 'string' ? response.content : '';
    return { technicalAnalysis: content || 'No technical summary returned.' };
  }

  const yesPrice = pricing?.buyYesPriceUsd ?? 0.5;
  const noPrice = pricing?.buyNoPriceUsd ?? 0.5;
  const impliedYes = yesPrice / (yesPrice + noPrice);

  return {
    technicalAnalysis: [
      `Scaffold technical pass for "${state.market.title}".`,
      `Implied yes from buy prices: ${(impliedYes * 100).toFixed(1)}%.`,
      `Orderbook depth — yes: ${yesBidDepth} levels, no: ${noBidDepth} levels.`,
    ].join(' '),
  };
}
