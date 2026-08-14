import { simulateBuyFill, simulateSellFill } from './fill-model.js';
import { bakeStopRecipe, exitHitReason, ratchetTrailingStop } from './exit-gate.js';
import type {
  FullQuote,
  PaperAction,
  PaperApplyOptions,
  PaperApplyResult,
  PaperPortfolio,
  PaperPosition,
  PaperSide,
} from './paper-types.js';

/**
 * Conservative paper fills and position-state transitions.
 *
 * Fill model assumptions (see `fill-model.ts` + ExecutionOptions):
 * - BUY YES / BUY NO fill at historically available asks (never mid)
 * - SELL YES / SELL NO fill at historically available bids (never mid)
 * - Depth ladders constrain size when present; otherwise a capped top-of-book
 * - Excess size is partially filled or fully rejected per config
 * - Slippage and fees worsen net P&L; gross (mid→mid) stays separate
 *
 * Impossible actions (sell with no inventory, buy with no usable price, etc.)
 * are rejected and recorded — the portfolio is left unchanged.
 */

/** Round money to cents so floating-point noise does not reach reports. */
function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Idle result when nothing trades. */
function idleResult(
  portfolio: PaperPortfolio,
  rejectionReason: string | null = null,
): PaperApplyResult {
  return {
    portfolio,
    appliedAction: 'hold',
    rejectionReason,
    stepRealisedPnlUsd: 0,
    fillPriceUsd: null,
    filledSizeUsd: 0,
    rejectedSizeUsd: 0,
    filledContracts: 0,
    rejectedContracts: 0,
    feeUsd: 0,
    fillPricing: 'none',
    usedDepth: false,
    residualPosition: null,
  };
}

/** True when a contract price is usable for a fill. */
export function isValidFillPrice(price: number | null | undefined): price is number {
  return (
    price !== null &&
    price !== undefined &&
    Number.isFinite(price) &&
    price > 0 &&
    price < 1
  );
}

/**
 * Conservative fill price for a paper action from the quote available at T.
 * Returns null when the quote cannot support that action.
 * (Top-of-book only — depth walks live in `simulateBuyFill` / `simulateSellFill`.)
 */
export function paperFillPrice(action: PaperAction, quote: FullQuote): number | null {
  if (action === 'hold') {
    return null;
  }
  if (action === 'buy_yes') {
    return isValidFillPrice(quote.buyYesPriceUsd) ? quote.buyYesPriceUsd : null;
  }
  if (action === 'buy_no') {
    return isValidFillPrice(quote.buyNoPriceUsd) ? quote.buyNoPriceUsd : null;
  }
  if (action === 'sell_yes') {
    return isValidFillPrice(quote.sellYesPriceUsd) ? quote.sellYesPriceUsd : null;
  }
  if (action === 'sell_no') {
    return isValidFillPrice(quote.sellNoPriceUsd) ? quote.sellNoPriceUsd : null;
  }
  return null;
}

/** Mark-to-market exit bid for an open side (what we would get if we sold now). */
export function markPriceForSide(side: PaperSide, quote: FullQuote): number | null {
  if (side === 'yes') {
    return isValidFillPrice(quote.sellYesPriceUsd) ? quote.sellYesPriceUsd : null;
  }
  return isValidFillPrice(quote.sellNoPriceUsd) ? quote.sellNoPriceUsd : null;
}

/** Unrealised PnL for an open position at the current quote. */
export function unrealisedPnlUsd(position: PaperPosition, quote: FullQuote): number | null {
  const mark = markPriceForSide(position.side, quote);
  if (mark === null) {
    return null;
  }
  return toCents(position.contracts * (mark - position.entryPriceUsd));
}

/** Holding duration in minutes from entry to `at`. Never negative. */
export function holdingMinutes(entryAtIso: string, at: Date): number {
  const entryMs = Date.parse(entryAtIso);
  if (!Number.isFinite(entryMs)) {
    return 0;
  }
  return Math.max(0, (at.getTime() - entryMs) / 60_000);
}

/**
 * Update MFE/MAE on an open position using the quote at T.
 * Returns a new position object (no mutation of the caller's reference).
 */
export function markPosition(
  position: PaperPosition,
  quote: FullQuote,
): { position: PaperPosition; unrealisedPnlUsd: number | null } {
  const unrealised = unrealisedPnlUsd(position, quote);
  const mark = markPriceForSide(position.side, quote);
  if (unrealised === null || mark === null) {
    return { position, unrealisedPnlUsd: null };
  }
  const marked: PaperPosition = {
    ...position,
    mfeUsd: Math.max(position.mfeUsd, unrealised),
    maeUsd: Math.min(position.maeUsd, unrealised),
  };
  return {
    unrealisedPnlUsd: unrealised,
    position: ratchetTrailingStop(marked, mark),
  };
}

/**
 * Map a swarm recommendation onto a paper action given current inventory.
 *
 * Rules:
 * - Flat + approved buy_* → open that side
 * - Open lot + stop / trail / time-stop hit → sell (seatbelt; ignores the swarm)
 * - Long YES + approved buy_no → sell YES (flip)
 * - Long NO + approved buy_yes → sell NO (flip)
 * - Otherwise → hold
 * - Force close when `forceClose` is true (market left open / end of series)
 *
 * Callers should `markPosition` first so a trailing floor is already ratcheted.
 */
export function proposePaperAction(options: {
  recommendation: import('../schemas/index.js').Recommendation;
  approved: boolean;
  position: PaperPosition | null;
  forceClose?: boolean;
  quote?: FullQuote;
  now?: Date;
}): PaperAction {
  const { recommendation, approved, position, forceClose = false, quote, now } = options;

  if (forceClose && position) {
    return position.side === 'yes' ? 'sell_yes' : 'sell_no';
  }

  if (!position) {
    if (approved && recommendation === 'buy_yes') {
      return 'buy_yes';
    }
    if (approved && recommendation === 'buy_no') {
      return 'buy_no';
    }
    return 'hold';
  }

  if (quote) {
    const mark = markPriceForSide(position.side, quote);
    const unrealised = unrealisedPnlUsd(position, quote);
    if (exitHitReason(position, mark, unrealised, now ?? new Date()) !== null) {
      return position.side === 'yes' ? 'sell_yes' : 'sell_no';
    }
  }

  if (position.side === 'yes') {
    if (approved && recommendation === 'buy_no') {
      return 'sell_yes';
    }
    return 'hold';
  }

  if (approved && recommendation === 'buy_yes') {
    return 'sell_no';
  }
  return 'hold';
}

/** Empty portfolio at the start of a market replay. */
export function emptyPortfolio(): PaperPortfolio {
  return { position: null, realisedPnlUsd: 0 };
}

/**
 * Apply a paper action to the portfolio using the quote (and optional depth) at T.
 *
 * Rejects impossible actions instead of inventing fills.
 */
export function applyPaperAction(
  portfolio: PaperPortfolio,
  action: PaperAction,
  quote: FullQuote,
  at: Date,
  sizeUsd: number,
  options: PaperApplyOptions = {},
): PaperApplyResult {
  if (action === 'hold') {
    return idleResult(portfolio);
  }

  if (action === 'buy_yes' || action === 'buy_no') {
    return applyBuy(portfolio, action, quote, at, sizeUsd, options);
  }

  return applySell(portfolio, action, quote, at, options);
}

function applyBuy(
  portfolio: PaperPortfolio,
  action: 'buy_yes' | 'buy_no',
  quote: FullQuote,
  at: Date,
  sizeUsd: number,
  options: PaperApplyOptions,
): PaperApplyResult {
  if (portfolio.position) {
    return idleResult(portfolio, `Cannot ${action}: already long ${portfolio.position.side}.`);
  }

  const fill = simulateBuyFill({
    action,
    quote,
    sizeUsd,
    book: options.book,
    execution: options.execution,
  });

  if (!fill.ok || fill.fillPriceUsd === null || fill.filledContracts <= 0) {
    return idleResult(portfolio, fill.reason ?? `Cannot ${action}: fill failed.`);
  }

  const side: PaperSide = action === 'buy_yes' ? 'yes' : 'no';
  // Bake the entry fee into the effective entry price so net P&L on exit
  // includes both legs without a separate fee ledger on the position.
  const effectiveEntry =
    fill.filledContracts > 0
      ? (fill.filledSizeUsd + fill.feeUsd) / fill.filledContracts
      : fill.fillPriceUsd;
  const position: PaperPosition = {
    side,
    sizeUsd: fill.filledSizeUsd,
    contracts: fill.filledContracts,
    entryAt: at.toISOString(),
    entryPriceUsd: effectiveEntry,
    mfeUsd: 0,
    maeUsd: 0,
    // Freeze the seatbelt on this lot so a later env change cannot rewrite it.
    ...bakeStopRecipe(effectiveEntry, at.toISOString()),
  };

  return {
    portfolio: { ...portfolio, position },
    appliedAction: action,
    rejectionReason: null,
    stepRealisedPnlUsd: 0,
    fillPriceUsd: fill.fillPriceUsd,
    filledSizeUsd: fill.filledSizeUsd,
    rejectedSizeUsd: fill.rejectedSizeUsd,
    filledContracts: fill.filledContracts,
    rejectedContracts: fill.rejectedContracts,
    feeUsd: fill.feeUsd,
    fillPricing: fill.pricing,
    usedDepth: fill.usedDepth,
    residualPosition: null,
  };
}

function applySell(
  portfolio: PaperPortfolio,
  action: 'sell_yes' | 'sell_no',
  quote: FullQuote,
  at: Date,
  options: PaperApplyOptions,
): PaperApplyResult {
  const needed: PaperSide = action === 'sell_yes' ? 'yes' : 'no';
  const position = portfolio.position;

  if (!position) {
    return idleResult(portfolio, `Cannot ${action}: no open position.`);
  }

  if (position.side !== needed) {
    return idleResult(
      portfolio,
      `Cannot ${action}: open position is ${position.side}, not ${needed}.`,
    );
  }

  const entryMs = Date.parse(position.entryAt);
  if (Number.isFinite(entryMs) && at.getTime() < entryMs) {
    return idleResult(
      portfolio,
      `Cannot exit before entry (${position.entryAt} > ${at.toISOString()}).`,
    );
  }

  const fill = simulateSellFill({
    action,
    quote,
    contractsWanted: position.contracts,
    book: options.book,
    execution: options.execution,
  });

  if (!fill.ok || fill.fillPriceUsd === null || fill.filledContracts <= 0) {
    return idleResult(portfolio, fill.reason ?? `Cannot ${action}: fill failed.`);
  }

  const sold = fill.filledContracts;
  const stepGross = sold * (fill.fillPriceUsd - position.entryPriceUsd);
  const stepRealisedPnlUsd = toCents(stepGross - fill.feeUsd);

  const remaining = position.contracts - sold;
  let residual: PaperPosition | null = null;
  if (remaining > 1e-9) {
    const remainingFraction = remaining / position.contracts;
    residual = {
      ...position,
      contracts: remaining,
      sizeUsd: toCents(position.sizeUsd * remainingFraction),
      // Keep entry price / MFE / MAE on the residual lot.
    };
  }

  return {
    portfolio: {
      position: residual,
      realisedPnlUsd: toCents(portfolio.realisedPnlUsd + stepRealisedPnlUsd),
    },
    appliedAction: action,
    rejectionReason: null,
    stepRealisedPnlUsd,
    fillPriceUsd: fill.fillPriceUsd,
    filledSizeUsd: fill.filledSizeUsd,
    rejectedSizeUsd: 0,
    filledContracts: sold,
    rejectedContracts: fill.rejectedContracts,
    feeUsd: fill.feeUsd,
    fillPricing: fill.pricing,
    usedDepth: fill.usedDepth,
    residualPosition: residual,
  };
}

/** Snapshot quote fields from a market snapshot / collector row. */
export function fullQuoteFrom(prices: FullQuote): FullQuote {
  return {
    buyYesPriceUsd: prices.buyYesPriceUsd,
    buyNoPriceUsd: prices.buyNoPriceUsd,
    sellYesPriceUsd: prices.sellYesPriceUsd,
    sellNoPriceUsd: prices.sellNoPriceUsd,
  };
}
