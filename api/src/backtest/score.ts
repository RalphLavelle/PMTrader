import type { RiskLimits } from '../agents/risk-manager/logic.js';
import { deriveWasCorrect } from '../labeller/scoring.js';
import type { MarketSnapshot, Recommendation } from '../schemas/index.js';
import {
  buildTradeEpisode,
  fixedHoldPolicy,
  type ExitPolicy,
} from '../trading/index.js';
import type { BaselineDecision, ReplayedDecision, ScoredDecision } from './types.js';

/**
 * Grading replayed decisions with an intramarket exit (primary) and optional
 * resolution context (secondary).
 */

/** The side the market itself favoured — the baseline buys this. */
function favouredSide(impliedYesProbability: number): Recommendation {
  if (impliedYesProbability > 0.5) {
    return 'buy_yes';
  }
  if (impliedYesProbability < 0.5) {
    return 'buy_no';
  }
  return 'hold';
}

/** Score the "just follow the crowd" reference bet with the same exit policy. */
function scoreBaseline(
  decision: ReplayedDecision,
  entry: MarketSnapshot,
  exit: MarketSnapshot | null,
  policy: ExitPolicy,
  limits: RiskLimits,
  resolvedTo: 'yes' | 'no' | null,
): BaselineDecision {
  const recommendation = favouredSide(decision.impliedYesProbability);
  const stakedUsd = recommendation === 'hold' ? 0 : limits.maxPositionUsd;

  const episode = buildTradeEpisode({
    recommendation,
    positionSizeUsd: stakedUsd,
    entryAt: entry.capturedAt,
    entry,
    exitAt: exit?.capturedAt ?? null,
    exit,
    policy,
  });

  return {
    recommendation,
    stakedUsd,
    wasProfitable: episode.wasProfitable,
    wasCorrect: deriveWasCorrect({ recommendation }, resolvedTo),
    realizedPnlUsd: episode.realizedPnlUsd,
    exitAt: episode.exitAt,
    exitPriceUsd: episode.exitPriceUsd,
  };
}

/**
 * Attach an exit (and optional resolution) to one replayed decision.
 *
 * `exit` must be a snapshot captured at or after entry + holdMinutes, or null
 * when the collector never saw a later quote.
 */
export function scoreDecision(
  decision: ReplayedDecision,
  entry: MarketSnapshot,
  exit: MarketSnapshot | null,
  limits: RiskLimits,
  options: {
    exitHoldMinutes: number;
    resolvedTo?: 'yes' | 'no' | null;
  },
): ScoredDecision {
  const policy = fixedHoldPolicy(options.exitHoldMinutes);
  const resolvedTo = options.resolvedTo ?? null;

  const bet = {
    recommendation: decision.recommendation,
    positionSizeUsd: decision.positionSizeUsd,
  };

  const episode = buildTradeEpisode({
    recommendation: bet.recommendation,
    positionSizeUsd: bet.positionSizeUsd,
    entryAt: entry.capturedAt,
    entry,
    exitAt: exit?.capturedAt ?? null,
    exit,
    policy,
  });

  return {
    ...decision,
    exitPolicy: policy,
    exitAt: episode.exitAt,
    exitPriceUsd: episode.exitPriceUsd,
    scoringMode: episode.scoringMode,
    wasProfitable: episode.wasProfitable,
    wasCorrect: deriveWasCorrect(bet, resolvedTo),
    resolvedTo,
    realizedPnlUsd: episode.realizedPnlUsd,
    entryQuote: {
      buyYesPriceUsd: entry.buyYesPriceUsd,
      buyNoPriceUsd: entry.buyNoPriceUsd,
    },
    exitQuote: exit
      ? { buyYesPriceUsd: exit.buyYesPriceUsd, buyNoPriceUsd: exit.buyNoPriceUsd }
      : null,
    baseline: scoreBaseline(decision, entry, exit, policy, limits, resolvedTo),
  };
}
