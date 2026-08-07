import type { RiskLimits } from '../agents/risk-manager/logic.js';
import { deriveWasCorrect, estimateRealizedPnlUsd } from '../labeller/scoring.js';
import type { MarketSnapshot, Recommendation } from '../schemas/index.js';
import type { BaselineDecision, ReplayedDecision, ScoredDecision } from './types.js';

/**
 * Grading replayed decisions against what the market actually did.
 *
 * The maths is not reimplemented here. `deriveWasCorrect` and
 * `estimateRealizedPnlUsd` come straight from the Phase 3 labeller, so a
 * backtest and a live scored run are graded by exactly the same rules. If those
 * rules ever change, both move together — which is the only way the two numbers
 * stay comparable.
 */

/**
 * The side the market itself favoured, which is what the baseline buys.
 *
 * A market sitting exactly on 50/50 has no favourite, so the baseline declines
 * rather than picking a side by coin flip.
 */
function favouredSide(impliedYesProbability: number): Recommendation {
  if (impliedYesProbability > 0.5) {
    return 'buy_yes';
  }
  if (impliedYesProbability < 0.5) {
    return 'buy_no';
  }
  return 'hold';
}

/**
 * Score the "just follow the crowd" reference bet at the same moment.
 *
 * It always stakes the maximum the Risk Manager could have staked. Comparing
 * raw profit against a strategy that sizes down would be unfair, so the metrics
 * layer compares *return on stake* instead, which is size-independent.
 */
function scoreBaseline(
  decision: ReplayedDecision,
  snapshot: MarketSnapshot,
  resolvedTo: 'yes' | 'no',
  limits: RiskLimits,
): BaselineDecision {
  const recommendation = favouredSide(decision.impliedYesProbability);
  const stakedUsd = recommendation === 'hold' ? 0 : limits.maxPositionUsd;
  const bet = { recommendation, positionSizeUsd: stakedUsd };

  return {
    recommendation,
    stakedUsd,
    wasCorrect: deriveWasCorrect(bet, resolvedTo),
    realizedPnlUsd: estimateRealizedPnlUsd(bet, snapshot, resolvedTo),
  };
}

/** Attach the outcome, and the baseline's outcome, to one replayed decision. */
export function scoreDecision(
  decision: ReplayedDecision,
  snapshot: MarketSnapshot,
  resolvedTo: 'yes' | 'no',
  limits: RiskLimits,
): ScoredDecision {
  const bet = {
    recommendation: decision.recommendation,
    positionSizeUsd: decision.positionSizeUsd,
  };

  return {
    ...decision,
    resolvedTo,
    wasCorrect: deriveWasCorrect(bet, resolvedTo),
    realizedPnlUsd: estimateRealizedPnlUsd(bet, snapshot, resolvedTo),
    baseline: scoreBaseline(decision, snapshot, resolvedTo, limits),
  };
}
