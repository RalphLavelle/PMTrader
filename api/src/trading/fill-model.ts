import { config } from '../config.js';
import type { FullQuote, PaperAction } from './paper-types.js';
import {
  DEFAULT_EXECUTION_OPTIONS,
  type DepthBook,
  type ExecutionOptions,
  type ExcessLiquidityMode,
  type SimulatedFill,
} from './execution-types.js';

/**
 * Depth-aware, conservative fill simulation.
 *
 * Jupiter books store *bids* on each outcome. Complementary asks come from
 * the other side:
 *   buy YES  → walk NO bids as implied YES asks (price = 1 − noBid)
 *   sell YES → walk YES bids directly
 *   buy NO   → walk YES bids as implied NO asks (price = 1 − yesBid)
 *   sell NO  → walk NO bids directly
 *
 * Never uses mid for execution. Mid is reserved for gross P&L reporting only.
 */

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampPrice(price: number): number | null {
  if (!Number.isFinite(price) || price <= 0 || price >= 1) {
    return null;
  }
  return price;
}

function isValidFillPrice(price: number | null | undefined): price is number {
  return (
    price !== null &&
    price !== undefined &&
    Number.isFinite(price) &&
    price > 0 &&
    price < 1
  );
}

/** Top-of-book ask/bid from the snapshot quote — never mid. */
function topOfBookPrice(
  action: Exclude<PaperAction, 'hold'>,
  quote: FullQuote,
): number | null {
  if (action === 'buy_yes') {
    return isValidFillPrice(quote.buyYesPriceUsd) ? quote.buyYesPriceUsd : null;
  }
  if (action === 'buy_no') {
    return isValidFillPrice(quote.buyNoPriceUsd) ? quote.buyNoPriceUsd : null;
  }
  if (action === 'sell_yes') {
    return isValidFillPrice(quote.sellYesPriceUsd) ? quote.sellYesPriceUsd : null;
  }
  return isValidFillPrice(quote.sellNoPriceUsd) ? quote.sellNoPriceUsd : null;
}

/** Merge config + overrides into a full ExecutionOptions object. */
export function resolveExecutionOptions(
  overrides?: Partial<ExecutionOptions>,
): ExecutionOptions {
  return {
    excessMode:
      overrides?.excessMode ??
      (config.paperExcessMode as ExcessLiquidityMode) ??
      DEFAULT_EXECUTION_OPTIONS.excessMode,
    slippageBps: overrides?.slippageBps ?? config.paperSlippageBps,
    feeBps: overrides?.feeBps ?? config.paperFeeBps,
    noBookDepthUsd: overrides?.noBookDepthUsd ?? config.paperNoBookDepthUsd,
    minFillFraction: overrides?.minFillFraction ?? config.paperMinFillFraction,
  };
}

/** Parse and sort a bid ladder high → low (best bid first). */
function sortedBids(
  levels: Array<[string, number]>,
): Array<{ price: number; quantity: number }> {
  return levels
    .map(([priceStr, quantity]) => ({
      price: Number.parseFloat(priceStr),
      quantity: Number(quantity) || 0,
    }))
    .filter((level) => Number.isFinite(level.price) && level.quantity > 0)
    .sort((a, b) => b.price - a.price);
}

/**
 * Levels we hit for a given action, as *our* fill prices + available contracts.
 * Complementary asks are derived from the opposite outcome's bids.
 */
function liquidityLevels(
  action: Exclude<PaperAction, 'hold'>,
  book: DepthBook,
): Array<{ price: number; quantity: number }> {
  if (action === 'sell_yes') {
    return sortedBids(book.yesDollars);
  }
  if (action === 'sell_no') {
    return sortedBids(book.noDollars);
  }
  if (action === 'buy_yes') {
    // Buying YES ≈ lifting NO bids: implied YES ask = 1 − noBid.
    return sortedBids(book.noDollars)
      .map((level) => ({
        price: 1 - level.price,
        quantity: level.quantity,
      }))
      .filter((level) => isValidFillPrice(level.price))
      .sort((a, b) => a.price - b.price); // best ask = cheapest first
  }
  // buy_no: implied NO ask = 1 − yesBid.
  return sortedBids(book.yesDollars)
    .map((level) => ({
      price: 1 - level.price,
      quantity: level.quantity,
    }))
    .filter((level) => isValidFillPrice(level.price))
    .sort((a, b) => a.price - b.price);
}

function applySlippage(
  price: number,
  action: Exclude<PaperAction, 'hold'>,
  slippageBps: number,
): number | null {
  const slip = Math.max(0, slippageBps) / 10_000;
  const isBuy = action === 'buy_yes' || action === 'buy_no';
  const moved = isBuy ? price * (1 + slip) : price * (1 - slip);
  return clampPrice(moved);
}

function emptyFail(reason: string): SimulatedFill {
  return {
    ok: false,
    reason,
    pricing: 'none',
    fillPriceUsd: null,
    filledSizeUsd: 0,
    rejectedSizeUsd: 0,
    filledContracts: 0,
    rejectedContracts: 0,
    feeUsd: 0,
    usedDepth: false,
  };
}

/**
 * Walk resting depth for a BUY sized in USD.
 * Spends budget across asks until size is filled or the book is exhausted.
 */
function walkBuy(
  levels: Array<{ price: number; quantity: number }>,
  sizeUsd: number,
): { contracts: number; costUsd: number; exhausted: boolean } {
  let remainingUsd = sizeUsd;
  let contracts = 0;
  let costUsd = 0;

  for (const level of levels) {
    if (remainingUsd <= 1e-9) {
      break;
    }
    const levelNotional = level.price * level.quantity;
    if (levelNotional <= 0) {
      continue;
    }
    if (remainingUsd >= levelNotional) {
      contracts += level.quantity;
      costUsd += levelNotional;
      remainingUsd -= levelNotional;
    } else {
      const take = remainingUsd / level.price;
      contracts += take;
      costUsd += remainingUsd;
      remainingUsd = 0;
    }
  }

  return {
    contracts,
    costUsd,
    exhausted: remainingUsd > 1e-6,
  };
}

/**
 * Walk resting depth for a SELL sized in contracts.
 * Hits bids until the position is flat or the book is exhausted.
 */
function walkSell(
  levels: Array<{ price: number; quantity: number }>,
  contractsWanted: number,
): { contracts: number; proceedsUsd: number; exhausted: boolean } {
  let remaining = contractsWanted;
  let filled = 0;
  let proceedsUsd = 0;

  for (const level of levels) {
    if (remaining <= 1e-9) {
      break;
    }
    const take = Math.min(remaining, level.quantity);
    filled += take;
    proceedsUsd += take * level.price;
    remaining -= take;
  }

  return {
    contracts: filled,
    proceedsUsd,
    exhausted: remaining > 1e-6,
  };
}

/**
 * Simulate a BUY against quote + optional depth.
 * `sizeUsd` is the requested notional; excess follows `excessMode`.
 */
export function simulateBuyFill(options: {
  action: 'buy_yes' | 'buy_no';
  quote: FullQuote;
  sizeUsd: number;
  book?: DepthBook | null;
  execution?: Partial<ExecutionOptions>;
}): SimulatedFill {
  const { action, quote, sizeUsd, book } = options;
  const exec = resolveExecutionOptions(options.execution);

  if (!(sizeUsd > 0)) {
    return emptyFail(`Cannot ${action}: position size must be positive.`);
  }

  const top = topOfBookPrice(action, quote);
  if (top === null) {
    return emptyFail(`No usable fill price for ${action}.`);
  }

  const hasBook = Boolean(book && (book.yesDollars.length > 0 || book.noDollars.length > 0));
  let filledContracts = 0;
  let costUsd = 0;
  let pricing: SimulatedFill['pricing'] = 'top_of_book';
  let usedDepth = false;
  let depthExhausted = false;

  if (hasBook && book) {
    const levels = liquidityLevels(action, book);
    if (levels.length === 0) {
      return emptyFail(`No resting depth to ${action}.`);
    }
    const walked = walkBuy(levels, sizeUsd);
    filledContracts = walked.contracts;
    costUsd = walked.costUsd;
    depthExhausted = walked.exhausted;
    pricing = 'depth_walk';
    usedDepth = true;
  } else {
    // No ladder: only allow a capped notional at the top-of-book ask.
    const capped = Math.min(sizeUsd, Math.max(0, exec.noBookDepthUsd));
    if (capped <= 0) {
      return emptyFail(`No depth available for ${action} (no book at T).`);
    }
    filledContracts = capped / top;
    costUsd = capped;
    depthExhausted = capped < sizeUsd - 1e-9;
    pricing = 'top_of_book';
  }

  const filledSizeUsd = toCents(costUsd);
  const rejectedSizeUsd = toCents(Math.max(0, sizeUsd - filledSizeUsd));

  if (filledSizeUsd <= 0 || filledContracts <= 0) {
    return emptyFail(`Insufficient depth to ${action}.`);
  }

  if (depthExhausted && exec.excessMode === 'reject_excess') {
    return {
      ...emptyFail(
        `Depth insufficient for full ${action} of $${sizeUsd.toFixed(2)}; reject_excess.`,
      ),
      rejectedSizeUsd: toCents(sizeUsd),
      usedDepth,
      pricing,
    };
  }

  if (filledSizeUsd / sizeUsd < exec.minFillFraction) {
    return emptyFail(
      `Fill $${filledSizeUsd.toFixed(2)} below minFillFraction ${exec.minFillFraction} of $${sizeUsd.toFixed(2)}.`,
    );
  }

  const rawVwap = costUsd / filledContracts;
  const slipped = applySlippage(rawVwap, action, exec.slippageBps);
  if (slipped === null) {
    return emptyFail(`Fill price after slippage left (0, 1) for ${action}.`);
  }

  // Never allow a buy better than the observed top-of-book ask.
  const fillPriceUsd = round4(Math.max(slipped, top));
  const feeUsd = toCents(filledSizeUsd * (Math.max(0, exec.feeBps) / 10_000));

  return {
    ok: true,
    reason: rejectedSizeUsd > 0 ? `Partial fill; rejected $${rejectedSizeUsd.toFixed(2)}.` : null,
    pricing,
    fillPriceUsd,
    filledSizeUsd: toCents(filledContracts * fillPriceUsd),
    rejectedSizeUsd,
    filledContracts,
    rejectedContracts: 0,
    feeUsd,
    usedDepth,
  };
}

/**
 * Simulate a SELL of `contractsWanted` against quote + optional depth.
 */
export function simulateSellFill(options: {
  action: 'sell_yes' | 'sell_no';
  quote: FullQuote;
  contractsWanted: number;
  book?: DepthBook | null;
  execution?: Partial<ExecutionOptions>;
}): SimulatedFill {
  const { action, quote, contractsWanted, book } = options;
  const exec = resolveExecutionOptions(options.execution);

  if (!(contractsWanted > 0)) {
    return emptyFail(`Cannot ${action}: no contracts to sell.`);
  }

  const top = topOfBookPrice(action, quote);
  if (top === null) {
    return emptyFail(`No usable fill price for ${action}.`);
  }

  const hasBook = Boolean(book && (book.yesDollars.length > 0 || book.noDollars.length > 0));
  let filledContracts = 0;
  let proceedsUsd = 0;
  let pricing: SimulatedFill['pricing'] = 'top_of_book';
  let usedDepth = false;
  let depthExhausted = false;

  if (hasBook && book) {
    const levels = liquidityLevels(action, book);
    if (levels.length === 0) {
      return emptyFail(`No resting depth to ${action}.`);
    }
    const walked = walkSell(levels, contractsWanted);
    filledContracts = walked.contracts;
    proceedsUsd = walked.proceedsUsd;
    depthExhausted = walked.exhausted;
    pricing = 'depth_walk';
    usedDepth = true;
  } else {
    // Cap by noBookDepthUsd notional at the top bid.
    const maxContracts = exec.noBookDepthUsd > 0 ? exec.noBookDepthUsd / top : 0;
    filledContracts = Math.min(contractsWanted, maxContracts);
    proceedsUsd = filledContracts * top;
    depthExhausted = filledContracts < contractsWanted - 1e-9;
    pricing = 'top_of_book';
  }

  const rejectedContracts = Math.max(0, contractsWanted - filledContracts);

  if (filledContracts <= 0) {
    return emptyFail(`Insufficient depth to ${action}.`);
  }

  if (depthExhausted && exec.excessMode === 'reject_excess') {
    return {
      ...emptyFail(
        `Depth insufficient for full ${action} of ${contractsWanted.toFixed(4)} contracts; reject_excess.`,
      ),
      rejectedContracts: contractsWanted,
      usedDepth,
      pricing,
    };
  }

  if (filledContracts / contractsWanted < exec.minFillFraction) {
    return emptyFail(
      `Fill ${filledContracts.toFixed(4)} contracts below minFillFraction ${exec.minFillFraction}.`,
    );
  }

  const rawVwap = proceedsUsd / filledContracts;
  const slipped = applySlippage(rawVwap, action, exec.slippageBps);
  if (slipped === null) {
    return emptyFail(`Fill price after slippage left (0, 1) for ${action}.`);
  }

  // Never allow a sell better than the observed top-of-book bid.
  const fillPriceUsd = round4(Math.min(slipped, top));
  const filledSizeUsd = toCents(filledContracts * fillPriceUsd);
  const feeUsd = toCents(filledSizeUsd * (Math.max(0, exec.feeBps) / 10_000));

  return {
    ok: true,
    reason:
      rejectedContracts > 0
        ? `Partial fill; rejected ${rejectedContracts.toFixed(4)} contracts.`
        : null,
    pricing,
    fillPriceUsd,
    filledSizeUsd,
    rejectedSizeUsd: 0,
    filledContracts,
    rejectedContracts,
    feeUsd,
    usedDepth,
  };
}
