import type { ClosedPaperTrade, PaperTradeConditions } from '../backtest/paper-types.js';
import { holdingMinutes } from './paper.js';
import type { FullQuote, PaperPortfolio, PaperSide } from './paper-types.js';

/**
 * Shared closed-trade builder for historical paper replay and live paper trading.
 *
 * Gross = mid→mid; net = realised fill P&L. Gap ≈ spread + slippage + fees.
 */

/** Round money to cents so floating-point noise does not reach reports. */
function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Mid price for a side from a full quote (reporting only — never a fill). */
function midForSide(side: PaperSide, quote: FullQuote): number {
  if (side === 'yes') {
    return (quote.buyYesPriceUsd + quote.sellYesPriceUsd) / 2;
  }
  return (quote.buyNoPriceUsd + quote.sellNoPriceUsd) / 2;
}

/** Build one coherent ClosedPaperTrade from an exited (or partially exited) lot. */
export function buildClosedPaperTrade(options: {
  marketId: string;
  position: NonNullable<PaperPortfolio['position']>;
  entryQuote: FullQuote;
  exitQuote: FullQuote;
  exitPriceUsd: number;
  exitAt: Date;
  netPnlUsd: number;
  entryConditions: PaperTradeConditions;
  exitConditions: PaperTradeConditions;
  swarmStateAtEntry: ClosedPaperTrade['swarmStateAtEntry'];
  resolvedTo: 'yes' | 'no' | null;
}): ClosedPaperTrade {
  const { position, entryQuote, exitQuote } = options;
  const grossPnlUsd = toCents(
    position.contracts *
      (midForSide(position.side, exitQuote) - midForSide(position.side, entryQuote)),
  );
  const estimatedCostUsd = toCents(grossPnlUsd - options.netPnlUsd);

  return {
    marketId: options.marketId,
    side: position.side,
    quantity: position.contracts,
    sizeUsd: position.sizeUsd,
    entryAt: position.entryAt,
    entryPriceUsd: position.entryPriceUsd,
    exitAt: options.exitAt.toISOString(),
    exitPriceUsd: options.exitPriceUsd,
    grossPnlUsd,
    estimatedCostUsd,
    netPnlUsd: options.netPnlUsd,
    holdingMinutes: holdingMinutes(position.entryAt, options.exitAt),
    mfeUsd: position.mfeUsd,
    maeUsd: position.maeUsd,
    entryConditions: options.entryConditions,
    exitConditions: options.exitConditions,
    swarmStateAtEntry: options.swarmStateAtEntry,
    resolvedTo: options.resolvedTo,
  };
}
