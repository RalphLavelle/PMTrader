import { signalToYesProbability } from '../agents/risk-manager/aggregate.js';
import type { ScoredDecision } from '../backtest/index.js';
import type { Stance, SwarmAnalysisResult } from '../schemas/index.js';
import { estimateIntramarketPnlUsd, wasTradeProfitable } from '../trading/index.js';
import type { GradedStance } from './types.js';

/**
 * Turning both evidence sources into one gradable shape.
 *
 * A stance is graded as a *trade*: if the specialist said YES, would buying YES
 * at the entry quote and selling at the exit quote have been profitable?
 */

/** Unit stake used when grading a specialist stance as a hypothetical trade. */
const UNIT_STAKE_USD = 1;

/** The market's own P(YES) from its two buy prices. */
export function marketImpliedYes(buyYesPriceUsd: number, buyNoPriceUsd: number): number {
  const total = buyYesPriceUsd + buyNoPriceUsd;
  if (!Number.isFinite(total) || total <= 0) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, buyYesPriceUsd / total));
}

/** Map a directional stance onto a swarm recommendation side. */
function stanceToRecommendation(stance: Stance): 'buy_yes' | 'buy_no' | null {
  if (stance === 'yes') {
    return 'buy_yes';
  }
  if (stance === 'no') {
    return 'buy_no';
  }
  return null;
}

/**
 * Grade one stance as an intramarket unit trade against entry/exit quotes.
 */
export function gradeStanceTrade(options: {
  stance: Stance;
  entry: { buyYesPriceUsd: number; buyNoPriceUsd: number };
  exit: { buyYesPriceUsd: number; buyNoPriceUsd: number } | null;
}): { tradePnlUsd: number | null; wasProfitable: boolean | null; scoringMode: GradedStance['scoringMode'] } {
  const recommendation = stanceToRecommendation(options.stance);
  if (!recommendation) {
    return { tradePnlUsd: null, wasProfitable: null, scoringMode: 'unresolved' };
  }

  if (!options.exit) {
    return { tradePnlUsd: null, wasProfitable: null, scoringMode: 'unresolved' };
  }

  const tradePnlUsd = estimateIntramarketPnlUsd(
    recommendation,
    UNIT_STAKE_USD,
    options.entry,
    options.exit,
  );

  return {
    tradePnlUsd,
    wasProfitable: wasTradeProfitable(tradePnlUsd),
    scoringMode: 'intramarket',
  };
}

/** Every specialist stance a replayed decision contains. */
export function stancesFromDecision(decision: ScoredDecision): GradedStance[] {
  return decision.signals.map((signal) => {
    const trade = gradeStanceTrade({
      stance: signal.stance,
      entry: decision.entryQuote,
      exit: decision.exitQuote,
    });

    return {
      agent: signal.agent,
      source: 'backtest' as const,
      marketId: decision.marketId,
      decidedAt: decision.decidedAt,
      stance: signal.stance,
      confidence: signal.confidence,
      predictedYes: signalToYesProbability(signal),
      marketYes: decision.impliedYesProbability,
      resolvedTo: decision.resolvedTo,
      wasProfitable: trade.wasProfitable,
      tradePnlUsd: trade.tradePnlUsd,
      scoringMode: trade.scoringMode,
      liquidityScore: decision.liquidityScore,
      hoursToClose: decision.hoursToClose,
      hadOrderbook: decision.hadOrderbook,
    };
  });
}

/** Whether a stored run's prices can be trusted. */
function hasUsablePrices(run: SwarmAnalysisResult): boolean {
  const { buyYesPriceUsd, buyNoPriceUsd } = run.snapshot;
  return [buyYesPriceUsd, buyNoPriceUsd].every(
    (price) => Number.isFinite(price) && price > 0 && price < 1,
  );
}

/**
 * Every specialist stance a stored, scored run contains.
 *
 * Prefers intramarket outcomes (exit prices on the outcome document). Falls
 * back to resolution-only scoring when that is all the labeller has attached.
 */
export function stancesFromRun(run: SwarmAnalysisResult): GradedStance[] {
  const outcome = run.record.outcome;
  if (!outcome) {
    return [];
  }
  if (!hasUsablePrices(run)) {
    return [];
  }

  const marketYes = marketImpliedYes(
    run.snapshot.buyYesPriceUsd,
    run.snapshot.buyNoPriceUsd,
  );

  const entry = {
    buyYesPriceUsd: run.snapshot.buyYesPriceUsd,
    buyNoPriceUsd: run.snapshot.buyNoPriceUsd,
  };

  // Prefer explicit exit quotes from an intramarket outcome.
  const exit =
    outcome.scoringMode === 'intramarket' &&
    outcome.exitPriceUsd != null &&
    Number.isFinite(outcome.exitPriceUsd)
      ? buildExitQuoteFromOutcome(run, outcome.exitPriceUsd)
      : null;

  const resolvedTo =
    outcome.resolvedTo === 'yes' || outcome.resolvedTo === 'no'
      ? outcome.resolvedTo
      : null;

  return run.record.signals.map((signal) => {
    let trade = gradeStanceTrade({ stance: signal.stance, entry, exit });

    // Secondary fallback: resolution-only runs still contribute a directional
    // wasProfitable via the run's own recommendation outcome when the stance
    // matches the recommendation side.
    if (trade.scoringMode === 'unresolved' && outcome.scoringMode === 'resolution') {
      trade = {
        tradePnlUsd: outcome.realizedPnlUsd,
        wasProfitable:
          outcome.wasProfitable ??
          (signal.stance !== 'neutral' && outcome.wasCorrect !== null
            ? signal.stance === outcome.resolvedTo
            : null),
        scoringMode: 'resolution',
      };
    }

    return {
      agent: signal.agent,
      source: 'live_run' as const,
      marketId: run.record.marketId,
      decidedAt: run.record.timestamp,
      stance: signal.stance,
      confidence: signal.confidence,
      predictedYes: signalToYesProbability(signal),
      marketYes,
      resolvedTo,
      wasProfitable: trade.wasProfitable,
      tradePnlUsd: trade.tradePnlUsd,
      scoringMode: trade.scoringMode,
      liquidityScore: run.features.liquidityScore,
      hoursToClose: run.features.hoursToClose,
      hadOrderbook: run.snapshot.yesDepth.levels > 0 || run.snapshot.noDepth.levels > 0,
    };
  });
}

/**
 * Reconstruct a two-sided exit quote from a single exit price on the outcome.
 *
 * The outcome stores the exit price for the *recommendation* side. For grading
 * opposite stances we approximate the other side as `1 − exit` — imperfect, but
 * better than dropping the live_run source entirely until we persist both legs.
 */
function buildExitQuoteFromOutcome(
  run: SwarmAnalysisResult,
  exitPriceUsd: number,
): { buyYesPriceUsd: number; buyNoPriceUsd: number } {
  const rec = run.record.recommendation.recommendation;
  if (rec === 'buy_yes') {
    return { buyYesPriceUsd: exitPriceUsd, buyNoPriceUsd: Math.max(0.01, 1 - exitPriceUsd) };
  }
  if (rec === 'buy_no') {
    return { buyNoPriceUsd: exitPriceUsd, buyYesPriceUsd: Math.max(0.01, 1 - exitPriceUsd) };
  }
  return {
    buyYesPriceUsd: run.snapshot.buyYesPriceUsd,
    buyNoPriceUsd: run.snapshot.buyNoPriceUsd,
  };
}

/** A stable key for "the same specialists looking at the same moment". */
export function decisionKey(stance: GradedStance): string {
  return `${stance.source}|${stance.marketId}|${stance.decidedAt}`;
}
