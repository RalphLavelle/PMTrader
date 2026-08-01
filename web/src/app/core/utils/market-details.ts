import { MarketDetail, MarketDetailField } from '../models/market.model';
import { formatMicroUsd, formatTimestamp } from './micro-usd';

/** Build display rows for every populated field on a market. */
export function buildMarketDetailFields(market: MarketDetail): MarketDetailField[] {
  const fields: MarketDetailField[] = [
    { label: 'Market ID', value: market.marketId },
    { label: 'Event ID', value: market.eventId ?? '—' },
    { label: 'Provider', value: market.provider },
    { label: 'Status', value: market.status },
    { label: 'Result', value: market.result ?? 'Unresolved' },
    { label: 'Team market', value: formatBool(market.isTeamMarket) },
    { label: 'Outcomes', value: market.outcomes?.join(', ') ?? '—' },
    { label: 'Opens', value: formatTimestamp(market.openTime) },
    { label: 'Closes', value: formatTimestamp(market.closeTime) },
    { label: 'Resolved at', value: market.resolveAt ?? '—' },
    { label: 'Market result account', value: market.marketResultPubkey ?? '—' },
    { label: 'Team', value: market.team ?? '—' },
    { label: 'Sports market type', value: market.sportsMarketType ?? '—' },
    { label: 'Sports line', value: market.sportsLine ?? '—' },
    { label: 'Game number', value: market.gameNumber?.toString() ?? '—' },
    {
      label: 'CLOB token IDs',
      value: market.clobTokenIds?.length ? market.clobTokenIds.join(', ') : '—',
    },
  ];

  if (market.pricing) {
    fields.push(
      { label: 'Buy Yes', value: formatMicroUsd(market.pricing.buyYesPriceUsd) },
      { label: 'Sell Yes', value: formatMicroUsd(market.pricing.sellYesPriceUsd) },
      { label: 'Buy No', value: formatMicroUsd(market.pricing.buyNoPriceUsd) },
      { label: 'Sell No', value: formatMicroUsd(market.pricing.sellNoPriceUsd) },
      { label: 'Volume', value: String(market.pricing.volume) },
    );
  }

  if (market.marketOptions?.length) {
    fields.push({
      label: 'Market options',
      value: market.marketOptions.map((o) => `${o.label} (buyYes=${o.buyYes})`).join('; '),
    });
  }

  return fields;
}

function formatBool(value: boolean | undefined): string {
  if (value === undefined) {
    return '—';
  }
  return value ? 'Yes' : 'No';
}
