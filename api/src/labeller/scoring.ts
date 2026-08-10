import {
  tradeOutcomeSchema,
  type AnalysisRecord,
  type MarketSnapshot,
  type SwarmRecommendation,
  type TradeOutcome,
} from '../schemas/index.js';
import {
  estimateIntramarketPnlUsd,
  wasTradeProfitable,
  type QuotePrices,
} from '../trading/index.js';

/**
 * Scoring a past recommendation against what actually happened.
 *
 * Two scoreboards share this file:
 *
 * 1. **Intramarket (primary)** — enter at the decision quote, exit at a later
 *    quote while the market is still open. A $0.10 → $0.50 YES trade is a win
 *    even if the market later resolves NO.
 * 2. **Resolution (secondary)** — hold until settlement at $1/$0. Kept so
 *    calibration and "did we pick the winner?" remain measurable.
 *
 * Pure functions with no database and no network, shared by the labeller, the
 * manual outcome PATCH route, and the Phase 4 backtest.
 */

/** The minimum a caller must supply to have a decision graded. */
type ScorableDecision = Pick<SwarmRecommendation, 'recommendation' | 'positionSizeUsd'>;

/** The two prices a hypothetical entry could have been filled at. */
type EntryPrices = Pick<MarketSnapshot, 'buyYesPriceUsd' | 'buyNoPriceUsd'>;

/**
 * Did the recommendation match the resolution?
 *
 * Returns null rather than false in two cases, because neither tells us anything
 * about the swarm's skill: the market has not resolved, or the swarm advised
 * holding and therefore never took a side.
 */
export function deriveWasCorrect(
  decision: Pick<SwarmRecommendation, 'recommendation'>,
  resolvedTo: 'yes' | 'no' | null,
): boolean | null {
  if (resolvedTo === null) {
    return null;
  }

  const { recommendation } = decision;
  if (recommendation === 'hold') {
    return null;
  }

  return recommendation === (resolvedTo === 'yes' ? 'buy_yes' : 'buy_no');
}

/**
 * Hold-to-settlement PnL (secondary scoreboard).
 *
 * A contract settles at exactly $1 if it resolves your way and $0 otherwise.
 * Buying at price `p` with stake `S` therefore:
 * - Correct: profit `S × (1 − p) / p`
 * - Wrong: loss `−S`
 */
export function estimateResolutionPnlUsd(
  decision: ScorableDecision,
  snapshot: EntryPrices,
  resolvedTo: 'yes' | 'no' | null,
): number | null {
  const { recommendation, positionSizeUsd } = decision;

  if (recommendation === 'hold' || positionSizeUsd <= 0) {
    return 0;
  }

  if (resolvedTo === null) {
    return null;
  }

  const entryPrice =
    recommendation === 'buy_yes' ? snapshot.buyYesPriceUsd : snapshot.buyNoPriceUsd;

  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || entryPrice >= 1) {
    return null;
  }

  const wasCorrect = deriveWasCorrect(decision, resolvedTo);
  if (wasCorrect === null) {
    return null;
  }

  const pnl = wasCorrect
    ? (positionSizeUsd * (1 - entryPrice)) / entryPrice
    : -positionSizeUsd;

  return Math.round(pnl * 100) / 100;
}

/**
 * @deprecated Prefer `estimateResolutionPnlUsd` or `estimateIntramarketPnlUsd`.
 * Kept as an alias so older call sites keep compiling during the migration.
 */
export const estimateRealizedPnlUsd = estimateResolutionPnlUsd;

/**
 * Build a resolution-based outcome document (secondary / legacy path).
 *
 * Prefer `buildIntramarketTradeOutcome` when an exit quote is available.
 */
export function buildTradeOutcome(
  record: AnalysisRecord,
  snapshot: MarketSnapshot,
  resolvedTo: 'yes' | 'no' | null,
  now: Date = new Date(),
): TradeOutcome {
  const realizedPnlUsd = estimateResolutionPnlUsd(
    record.recommendation,
    snapshot,
    resolvedTo,
  );
  const entryPriceUsd =
    record.recommendation.recommendation === 'buy_yes'
      ? snapshot.buyYesPriceUsd
      : record.recommendation.recommendation === 'buy_no'
        ? snapshot.buyNoPriceUsd
        : null;

  return tradeOutcomeSchema.parse({
    resolved: resolvedTo !== null,
    resolvedTo,
    scoringMode: 'resolution',
    entryPriceUsd,
    exitPriceUsd: null,
    exitAt: null,
    holdMinutes: null,
    realizedPnlUsd,
    wasCorrect: deriveWasCorrect(record.recommendation, resolvedTo),
    wasProfitable: wasTradeProfitable(realizedPnlUsd),
    recordedAt: now.toISOString(),
  });
}

/**
 * Build an intramarket outcome: entry at the run's snapshot, exit at a later quote.
 *
 * This is the primary learning signal for the trading objective.
 */
export function buildIntramarketTradeOutcome(options: {
  record: AnalysisRecord;
  entry: QuotePrices;
  exit: QuotePrices;
  exitAt: Date | string;
  holdMinutes: number;
  /** Optional resolution context — does not change the primary PnL. */
  resolvedTo?: 'yes' | 'no' | null;
  now?: Date;
}): TradeOutcome {
  const {
    record,
    entry,
    exit,
    exitAt,
    holdMinutes,
    resolvedTo = null,
    now = new Date(),
  } = options;

  const decision = record.recommendation;
  const realizedPnlUsd = estimateIntramarketPnlUsd(
    decision.recommendation,
    decision.positionSizeUsd,
    entry,
    exit,
  );

  const entryPriceUsd =
    decision.recommendation === 'buy_yes'
      ? entry.buyYesPriceUsd
      : decision.recommendation === 'buy_no'
        ? entry.buyNoPriceUsd
        : null;
  const exitPriceUsd =
    decision.recommendation === 'buy_yes'
      ? exit.buyYesPriceUsd
      : decision.recommendation === 'buy_no'
        ? exit.buyNoPriceUsd
        : null;

  return tradeOutcomeSchema.parse({
    resolved: resolvedTo !== null,
    resolvedTo,
    scoringMode: 'intramarket',
    entryPriceUsd,
    exitPriceUsd,
    exitAt: exitAt instanceof Date ? exitAt.toISOString() : exitAt,
    holdMinutes,
    realizedPnlUsd,
    wasCorrect: deriveWasCorrect(decision, resolvedTo),
    wasProfitable: wasTradeProfitable(realizedPnlUsd),
    recordedAt: now.toISOString(),
  });
}
