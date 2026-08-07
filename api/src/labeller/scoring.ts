import {
  tradeOutcomeSchema,
  type AnalysisRecord,
  type MarketSnapshot,
  type SwarmRecommendation,
  type TradeOutcome,
} from '../schemas/index.js';

/**
 * Scoring a past recommendation against what actually happened.
 *
 * These are pure functions with no database and no network, which is deliberate:
 * "was the swarm right, and by how much?" is the question the whole research
 * dataset exists to answer, so it should be trivially unit-testable.
 *
 * Shared by three callers so all of them score identically: the automatic
 * labeller, the manual `PATCH /api/swarm/analyses/:id/outcome` route, and the
 * Phase 4 backtest.
 *
 * They take the recommendation rather than the whole stored run, because the
 * backtest scores decisions it has just replayed and never persisted, so there
 * is no `AnalysisRecord` to hand over.
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
 * What the recommendation would have earned or lost, had it been acted on.
 *
 * PMTrader never executes trades, so this is always hypothetical — the schema
 * field is documented as "if the recommendation was acted on".
 *
 * The maths comes from how binary markets pay out. A contract settles at exactly
 * $1 if it resolves your way and $0 otherwise. Buying at price `p` therefore
 * costs `p` per contract, so a stake of `S` buys `S / p` contracts:
 *
 * - Correct: payout is `S / p`, so profit is `S / p − S`, i.e. `S × (1 − p) / p`.
 *   Buying at $0.20 and being right nearly quintuples the stake.
 * - Wrong: the contracts expire worthless and the whole stake is lost, `−S`.
 *
 * Returns null when the entry price is unusable — a missing quote, or one of the
 * pre-Phase-0 runs whose prices were all stored as 0 or 1. Guessing a number
 * there would quietly poison the fitness statistics later.
 */
export function estimateRealizedPnlUsd(
  decision: ScorableDecision,
  snapshot: EntryPrices,
  resolvedTo: 'yes' | 'no' | null,
): number | null {
  const { recommendation, positionSizeUsd } = decision;

  // No position was taken, so there is genuinely nothing to win or lose.
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
 * Build the outcome document to attach to a stored run.
 *
 * Parsing through the Zod schema at the end means a bug in the maths above
 * surfaces here as a validation error rather than as a corrupt row in MongoDB.
 */
export function buildTradeOutcome(
  record: AnalysisRecord,
  snapshot: MarketSnapshot,
  resolvedTo: 'yes' | 'no' | null,
  now: Date = new Date(),
): TradeOutcome {
  return tradeOutcomeSchema.parse({
    resolved: true,
    resolvedTo,
    realizedPnlUsd: estimateRealizedPnlUsd(record.recommendation, snapshot, resolvedTo),
    wasCorrect: deriveWasCorrect(record.recommendation, resolvedTo),
    recordedAt: now.toISOString(),
  });
}
