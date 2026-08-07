import { upsertMarketLabel } from '../collector/store.js';
import { jupiter } from '../jupiter/index.js';
import type { JupiterMarketDetail } from '../jupiter/types.js';
import type { LabelAttempt } from './types.js';

/**
 * Writing resolution labels for markets.
 *
 * One market gets one label document, keyed by `marketId`. Every snapshot,
 * orderbook, and trade already stored for that market then inherits the label at
 * read time — nothing historical is ever rewritten. That is the whole trick: a
 * single small write turns thousands of unlabelled rows into supervised data.
 *
 * Both the collector's watchlist `labels` stream and the Phase 3 labeller call
 * `labelMarketFromJupiter`, so there is exactly one definition of "settled".
 */

/** Minimal shape needed to judge whether a market has finished trading. */
type SettlementFields = Pick<JupiterMarketDetail, 'status' | 'result'>;

/**
 * Has the market stopped trading?
 *
 * True either when Jupiter published a result, or when the status left "open".
 * A blank status is treated as still-open because Jupiter occasionally returns
 * an empty string, and assuming settlement there would label markets wrongly.
 */
export function isSettled(market: SettlementFields): boolean {
  if (market.result === 'yes' || market.result === 'no') {
    return true;
  }
  return market.status !== 'open' && market.status !== '';
}

/**
 * Has the market produced a usable answer?
 *
 * A market can be settled without being decisive — closed, void, or cancelled
 * with no winning side. Only decisive markets can score a past recommendation,
 * so the two ideas are kept apart rather than collapsed into one boolean.
 */
export function isDecisive(market: SettlementFields): boolean {
  return market.result === 'yes' || market.result === 'no';
}

/**
 * Fetch one market from Jupiter and write its label if it has settled.
 *
 * Costs exactly one Jupiter request, which matters: the Free tier allows 60 per
 * minute shared across the UI, the swarm, and the collector, so the caller
 * decides how many markets to check per pass.
 */
export async function labelMarketFromJupiter(marketId: string): Promise<LabelAttempt> {
  const market = await jupiter.getMarket(marketId);

  if (!isSettled(market)) {
    return 'still-open';
  }

  const changed = await upsertMarketLabel({
    marketId: market.marketId,
    eventId: market.eventId,
    title: market.title,
    status: market.status,
    result: market.result,
    closeTime: market.closeTime ?? null,
    resolveAt: market.resolveAt ?? null,
    labelledAt: new Date(),
  });

  return changed ? 'labelled' : 'unchanged';
}
