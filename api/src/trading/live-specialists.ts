import { AGENT_NAMES } from '../agents/names.js';
import { configuredRiskLimits } from '../agents/risk-manager/limits.js';
import type { ClosedPaperTrade, PaperTradeConditions } from '../backtest/paper-types.js';
import type { DecisionPoint } from '../backtest/history.js';
import { replayDecision } from '../backtest/replay.js';
import { config } from '../config.js';
import { proposeFromStance } from '../fitness/trades.js';
import type { AgentName } from '../schemas/index.js';
import { buildClosedPaperTrade } from './closed-trade.js';
import {
  applyPaperAction,
  emptyPortfolio,
  markPosition,
} from './paper.js';
import type { FullQuote, PaperPortfolio } from './paper-types.js';
import type { LivePaperMarketState } from './live-types.js';
import type { DepthBook, ExecutionOptions } from './execution-types.js';
import { getAgentWeightMap } from '../adaptive/index.js';

/**
 * Per-specialist unit-stake paper books for the live loop.
 *
 * Mirrors fitness/trades.ts so adaptive weights see the same evidence shape
 * online and offline.
 */

const REPLAY_SPECIALISTS: AgentName[] = [
  AGENT_NAMES.trend,
  AGENT_NAMES.meanReversion,
];

function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function tradeConditions(
  quote: FullQuote,
  point: DecisionPoint,
): PaperTradeConditions {
  return {
    yesPriceUsd: quote.buyYesPriceUsd,
    noPriceUsd: quote.buyNoPriceUsd,
    liquidityScore: point.context.features.liquidityScore,
    hoursToClose: point.context.features.hoursToClose,
    hadOrderbook: point.context.meta.hadOrderbook,
    change5m: point.context.trajectory.change5m,
    volatility: point.context.trajectory.volatility,
  };
}

function snapshotWeights(): Partial<Record<AgentName, number>> | null {
  const map = getAgentWeightMap();
  const entries = Object.entries(map).filter(
    (e): e is [AgentName, number] =>
      typeof e[1] === 'number' && Number.isFinite(e[1]),
  );
  return entries.length > 0
    ? (Object.fromEntries(entries) as Partial<Record<AgentName, number>>)
    : null;
}

/** Advance specialist books one tip; return any newly closed trades. */
export function advanceSpecialistBooks(options: {
  state: LivePaperMarketState;
  point: DecisionPoint;
  quote: FullQuote;
  depthBook: DepthBook | null;
  execution: ExecutionOptions;
  forceClose: boolean;
  resolvedTo: 'yes' | 'no' | null;
}): {
  state: LivePaperMarketState;
  closed: Array<{
    owner: AgentName;
    closed: ClosedPaperTrade;
    weights: Partial<Record<AgentName, number>> | null;
  }>;
} {
  const {
    point,
    quote,
    depthBook,
    execution,
    forceClose,
    resolvedTo,
  } = options;
  let state = options.state;
  const closed: Array<{
    owner: AgentName;
    closed: ClosedPaperTrade;
    weights: Partial<Record<AgentName, number>> | null;
  }> = [];

  const stake = config.fitnessSpecialistStakeUsd;
  const at = new Date(point.context.at);
  const specialistPortfolios = { ...state.specialistPortfolios };
  const specialistEntryMeta = { ...state.specialistEntryMeta };

  const replayed = replayDecision(point, {
    ...configuredRiskLimits,
    minConfidence: config.swarmMinConfidence,
  });

  for (const agent of REPLAY_SPECIALISTS) {
    let portfolio: PaperPortfolio =
      specialistPortfolios[agent] ?? emptyPortfolio();

    if (portfolio.position) {
      const marked = markPosition(portfolio.position, quote);
      portfolio = { ...portfolio, position: marked.position };
    }

    const signal = replayed.signals.find((row) => row.agent === agent);
    const stance = signal?.stance ?? 'neutral';
    const proposed = proposeFromStance({
      stance,
      position: portfolio.position,
      forceClose: Boolean(portfolio.position) && forceClose,
    });

    const before = portfolio.position;
    const entryMeta = specialistEntryMeta[agent] ?? null;
    const applied = applyPaperAction(portfolio, proposed, quote, at, stake, {
      book: depthBook,
      execution,
    });
    portfolio = applied.portfolio;
    specialistPortfolios[agent] = portfolio;

    if (applied.appliedAction.startsWith('buy_') && !applied.rejectionReason) {
      specialistEntryMeta[agent] = {
        entryQuote: quote,
        entryConditions: tradeConditions(quote, point),
        stanceConfidence: signal?.confidence ?? 0,
      };
    }

    if (
      applied.appliedAction.startsWith('sell_') &&
      !applied.rejectionReason &&
      before &&
      entryMeta &&
      applied.fillPriceUsd !== null &&
      applied.filledContracts > 0
    ) {
      const soldFraction = applied.filledContracts / before.contracts;
      const soldSlice = {
        ...before,
        contracts: applied.filledContracts,
        sizeUsd: toCents(before.sizeUsd * soldFraction),
      };
      const closedTrade = buildClosedPaperTrade({
        marketId: state.marketId,
        position: soldSlice,
        entryQuote: entryMeta.entryQuote,
        exitQuote: quote,
        exitPriceUsd: applied.fillPriceUsd,
        exitAt: at,
        netPnlUsd: applied.stepRealisedPnlUsd,
        entryConditions: entryMeta.entryConditions,
        exitConditions: tradeConditions(quote, point),
        swarmStateAtEntry: {
          recommendation:
            stance === 'yes' ? 'buy_yes' : stance === 'no' ? 'buy_no' : 'hold',
          confidence: entryMeta.stanceConfidence,
          approved: true,
          signals: replayed.signals,
        },
        resolvedTo,
      });
      closed.push({
        owner: agent,
        closed: closedTrade,
        weights: snapshotWeights(),
      });
      if (!applied.residualPosition) {
        delete specialistEntryMeta[agent];
      }
    }
  }

  state = { ...state, specialistPortfolios, specialistEntryMeta };
  return { state, closed };
}

/** Shared tip → trade-conditions helper for the swarm book. */
export function tipTradeConditions(
  quote: FullQuote,
  point: DecisionPoint,
): PaperTradeConditions {
  return tradeConditions(quote, point);
}

export { snapshotWeights };
