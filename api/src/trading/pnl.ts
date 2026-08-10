import type { MarketSnapshotDoc } from '../collector/types.js';
import type { Recommendation } from '../schemas/index.js';
import type { ExitPolicy, QuotePrices, TradeEpisode } from './types.js';

/**
 * Mark-to-market PnL for prediction-market contracts exited before settlement.
 *
 * Binary contracts still settle at $1 or $0 eventually, but a trader can sell
 * earlier. Buying YES at $0.10 and selling at $0.50 locks in $0.40 per share
 * regardless of how the market later resolves — that is the trade we grade.
 *
 * Pure functions only: easy to unit-test with the textbook examples.
 */

/** Round money to cents so floating-point noise does not reach the UI. */
function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The fill price for opening (or closing) one side of a binary market.
 *
 * Opening YES uses the YES ask; opening NO uses the NO ask. Closing is the
 * same side's later ask in our simplified model — we do not model spread
 * separately yet, because the collector stores buy prices consistently and
 * that keeps entry and exit comparable.
 */
export function sidePrice(
  recommendation: Recommendation,
  quote: QuotePrices,
): number | null {
  if (recommendation === 'buy_yes') {
    return quote.buyYesPriceUsd;
  }
  if (recommendation === 'buy_no') {
    return quote.buyNoPriceUsd;
  }
  return null;
}

/**
 * Profit or loss from buying at `entry` and selling at `exit`.
 *
 * Stake `S` buys `S / entry` contracts. Selling each at `exit` returns
 * `(S / entry) × exit`, so profit is `S × (exit − entry) / entry`.
 *
 * Returns null when prices are missing or outside (0, 1) — guessing would
 * poison the fitness statistics the same way zero-priced Phase-0 rows did.
 */
export function estimateIntramarketPnlUsd(
  recommendation: Recommendation,
  positionSizeUsd: number,
  entry: QuotePrices,
  exit: QuotePrices,
): number | null {
  if (recommendation === 'hold' || positionSizeUsd <= 0) {
    return 0;
  }

  const entryPrice = sidePrice(recommendation, entry);
  const exitPrice = sidePrice(recommendation, exit);

  if (
    entryPrice === null ||
    exitPrice === null ||
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(exitPrice) ||
    entryPrice <= 0 ||
    entryPrice >= 1 ||
    exitPrice <= 0 ||
    exitPrice >= 1
  ) {
    return null;
  }

  const pnl = (positionSizeUsd * (exitPrice - entryPrice)) / entryPrice;
  return toCents(pnl);
}

/** True when a graded trade made money; null when there is nothing to say. */
export function wasTradeProfitable(realizedPnlUsd: number | null): boolean | null {
  if (realizedPnlUsd === null) {
    return null;
  }
  // Holds score 0 PnL and are neither wins nor losses for accuracy counts.
  if (realizedPnlUsd === 0) {
    return null;
  }
  return realizedPnlUsd > 0;
}

/**
 * First snapshot at or after `entryMs + holdMinutes`, looking only forward.
 *
 * Snapshots must already be sorted oldest → newest. Looking only forward is
 * what keeps look-ahead bias out of the exit: a decision at T may never use a
 * quote from before T + hold, and never invent a future that was not collected.
 */
export function findExitSnapshot(
  snapshots: MarketSnapshotDoc[],
  entryMs: number,
  policy: ExitPolicy,
): MarketSnapshotDoc | null {
  const earliestExitMs = entryMs + policy.holdMinutes * 60_000;

  for (const snap of snapshots) {
    const at = snap.capturedAt.getTime();
    if (at >= earliestExitMs) {
      return snap;
    }
  }

  return null;
}

/**
 * Build a full trade episode from an entry decision and a later exit quote.
 *
 * When no exit snapshot exists yet, the episode is marked `unresolved` and
 * left unscored — better than pretending the position settled at $1/$0.
 */
export function buildTradeEpisode(options: {
  recommendation: Recommendation;
  positionSizeUsd: number;
  entryAt: Date | string;
  entry: QuotePrices;
  exitAt: Date | string | null;
  exit: QuotePrices | null;
  policy: ExitPolicy;
}): TradeEpisode {
  const entryAt =
    options.entryAt instanceof Date
      ? options.entryAt.toISOString()
      : options.entryAt;
  const exitAt =
    options.exitAt === null
      ? null
      : options.exitAt instanceof Date
        ? options.exitAt.toISOString()
        : options.exitAt;

  const entryPriceUsd = sidePrice(options.recommendation, options.entry);
  const exitPriceUsd =
    options.exit === null ? null : sidePrice(options.recommendation, options.exit);

  if (options.recommendation === 'hold' || options.positionSizeUsd <= 0) {
    return {
      recommendation: options.recommendation,
      positionSizeUsd: options.positionSizeUsd,
      entryAt,
      entryPriceUsd,
      exitAt,
      exitPriceUsd,
      holdMinutes: options.policy.holdMinutes,
      realizedPnlUsd: 0,
      wasProfitable: null,
      scoringMode: options.exit ? 'intramarket' : 'unresolved',
    };
  }

  if (!options.exit) {
    return {
      recommendation: options.recommendation,
      positionSizeUsd: options.positionSizeUsd,
      entryAt,
      entryPriceUsd,
      exitAt: null,
      exitPriceUsd: null,
      holdMinutes: options.policy.holdMinutes,
      realizedPnlUsd: null,
      wasProfitable: null,
      scoringMode: 'unresolved',
    };
  }

  const realizedPnlUsd = estimateIntramarketPnlUsd(
    options.recommendation,
    options.positionSizeUsd,
    options.entry,
    options.exit,
  );

  return {
    recommendation: options.recommendation,
    positionSizeUsd: options.positionSizeUsd,
    entryAt,
    entryPriceUsd,
    exitAt,
    exitPriceUsd,
    holdMinutes: options.policy.holdMinutes,
    realizedPnlUsd,
    wasProfitable: wasTradeProfitable(realizedPnlUsd),
    scoringMode: 'intramarket',
  };
}
