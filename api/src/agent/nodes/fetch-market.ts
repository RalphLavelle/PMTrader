import { jupiter } from '../../jupiter/index.js';
import type { AgentGraphState } from '../state.js';

/** Loads market metadata and orderbook depth from Jupiter. */
export async function fetchMarketNode(
  state: AgentGraphState,
): Promise<Partial<AgentGraphState>> {
  try {
    const [market, orderbook] = await Promise.all([
      jupiter.getMarket(state.marketId),
      jupiter.getOrderbook(state.marketId),
    ]);

    return { market, orderbook };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to fetch market data.';
    return { errors: [message] };
  }
}
