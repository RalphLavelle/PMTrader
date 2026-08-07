import { signalToYesProbability } from '../agents/risk-manager/aggregate.js';
import type { ScoredDecision } from '../backtest/index.js';
import type { SwarmAnalysisResult } from '../schemas/index.js';
import type { GradedStance } from './types.js';

/**
 * Turning both evidence sources into one gradable shape.
 *
 * A replayed backtest decision and a stored swarm run look nothing alike, but
 * they contain the same thing: a specialist took a stance, the market was
 * showing a price, and the market later resolved. Normalising them here means
 * every metric downstream works on one type and never has to ask where a stance
 * came from — except when reporting it, which is deliberate.
 */

/**
 * The market's own P(YES) from its two buy prices.
 *
 * This is the reference forecaster every agent is scored against. In a binary
 * market the two sides should sum to about $1, so YES's share of the total is
 * the probability the crowd is pricing in. A missing or nonsensical pair falls
 * back to 0.5, the same "we do not know" default the rest of the app uses.
 */
export function marketImpliedYes(buyYesPriceUsd: number, buyNoPriceUsd: number): number {
  const total = buyYesPriceUsd + buyNoPriceUsd;
  if (!Number.isFinite(total) || total <= 0) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, buyYesPriceUsd / total));
}

/**
 * Every specialist stance a replayed decision contains.
 *
 * One decision point yields one stance per agent that took part, and each is
 * graded on its own. Whether the Risk Manager approved the blend is irrelevant
 * here — that is precisely the distinction Phase 5 exists to draw.
 */
export function stancesFromDecision(decision: ScoredDecision): GradedStance[] {
  return decision.signals.map((signal) => ({
    agent: signal.agent,
    source: 'backtest' as const,
    marketId: decision.marketId,
    decidedAt: decision.decidedAt,
    stance: signal.stance,
    confidence: signal.confidence,
    predictedYes: signalToYesProbability(signal),
    marketYes: decision.impliedYesProbability,
    resolvedTo: decision.resolvedTo,
    liquidityScore: decision.liquidityScore,
    hoursToClose: decision.hoursToClose,
    hadOrderbook: decision.hadOrderbook,
  }));
}

/**
 * Whether a stored run's prices can be trusted.
 *
 * Runs saved before the Phase 0 unit fix recorded every price as 0 or 1 and
 * every implied probability as 0.5. Grading a specialist against a market that
 * never really sat at 100% would invent skill (or incompetence) that never
 * happened, so those runs are excluded rather than quietly averaged in.
 */
function hasUsablePrices(run: SwarmAnalysisResult): boolean {
  const { buyYesPriceUsd, buyNoPriceUsd } = run.snapshot;
  return [buyYesPriceUsd, buyNoPriceUsd].every(
    (price) => Number.isFinite(price) && price > 0 && price < 1,
  );
}

/**
 * Every specialist stance a stored, scored run contains.
 *
 * Returns nothing when the run has no outcome yet (the labeller has not reached
 * it, or its market never resolved decisively) or when its prices are
 * pre-Phase-0 artefacts.
 *
 * This is the only path that can grade the **semantic agent**, which is why it
 * exists at all despite the sample being small: the agent the backtest cannot
 * replay is also the one supplying most of the swarm's directional opinion.
 */
export function stancesFromRun(run: SwarmAnalysisResult): GradedStance[] {
  const resolvedTo = run.record.outcome?.resolvedTo;
  if (resolvedTo !== 'yes' && resolvedTo !== 'no') {
    return [];
  }
  if (!hasUsablePrices(run)) {
    return [];
  }

  const marketYes = marketImpliedYes(
    run.snapshot.buyYesPriceUsd,
    run.snapshot.buyNoPriceUsd,
  );

  return run.record.signals.map((signal) => ({
    agent: signal.agent,
    source: 'live_run' as const,
    marketId: run.record.marketId,
    decidedAt: run.record.timestamp,
    stance: signal.stance,
    confidence: signal.confidence,
    predictedYes: signalToYesProbability(signal),
    marketYes,
    resolvedTo,
    liquidityScore: run.features.liquidityScore,
    hoursToClose: run.features.hoursToClose,
    // A stored run captured depth live, so any level at all means the agents
    // could see the book. Zero levels means they were working blind.
    hadOrderbook: run.snapshot.yesDepth.levels > 0 || run.snapshot.noDepth.levels > 0,
  }));
}

/**
 * A stable key for "the same specialists looking at the same moment".
 *
 * Head-to-head comparison needs to line stances up by decision point. The
 * source is part of the key because a replayed decision and a live run about
 * the same market at the same second are still two separate observations.
 */
export function decisionKey(stance: GradedStance): string {
  return `${stance.source}|${stance.marketId}|${stance.decidedAt}`;
}
