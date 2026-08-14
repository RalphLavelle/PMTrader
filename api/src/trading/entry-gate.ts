import { config } from '../config.js';

/**
 * Paper entry gate — shared by the live paper loop and the offline fitness
 * simulation so agents earn (or lose) fitness on the same playing field.
 *
 * Why it exists: the 2026-08-11 fitness pass showed spread/slippage costs were
 * ~85% of the trend agent's paper losses. Every losing live trade had entered
 * a market with a wide, incoherent quote (buyYes + buyNo up to $1.51 against a
 * healthy ~$1.00) or near-zero liquidity. Trading there measures the venue,
 * not the agent, so those entries are blocked before they pollute the
 * learning evidence.
 */

/** What the gate needs to know about the market at entry time. */
export interface EntryGateInput {
  buyYesPriceUsd: number;
  buyNoPriceUsd: number;
  /** Derived liquidity score, 0 (untradeable) to 1 (deep book). */
  liquidityScore: number;
}

/**
 * Returns a human-readable reason why a paper entry should be blocked,
 * or null when the market is coherent enough to trade.
 */
export function entryBlockReason(input: EntryGateInput): string | null {
  const quoteSum = input.buyYesPriceUsd + input.buyNoPriceUsd;

  if (quoteSum > config.paperMaxEntryQuoteSum) {
    return (
      `entry_gate: quote incoherent (yes+no $${quoteSum.toFixed(2)} > ` +
      `$${config.paperMaxEntryQuoteSum.toFixed(2)} max) — spread would dwarf any edge`
    );
  }

  if (input.liquidityScore < config.paperMinEntryLiquidity) {
    return (
      `entry_gate: liquidity ${input.liquidityScore.toFixed(2)} below ` +
      `${config.paperMinEntryLiquidity.toFixed(2)} floor — fill not plausible`
    );
  }

  return null;
}
