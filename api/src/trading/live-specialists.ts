import { AGENT_NAMES } from '../agents/names.js';
import { configuredRiskLimits } from '../agents/risk-manager/limits.js';
import type { ClosedPaperTrade, PaperTradeConditions } from '../backtest/paper-types.js';
import type { DecisionPoint } from '../backtest/history.js';
import { replayDecision } from '../backtest/replay.js';
import { config } from '../config.js';
import { proposeFromStance } from '../fitness/trades.js';
import type { AgentName } from '../schemas/index.js';
import { buildClosedPaperTrade } from './closed-trade.js';
import { entryBlockReason } from './entry-gate.js';
import { closedExitReason, exitHitReason } from './exit-gate.js';
import {
  applyPaperAction,
  emptyPortfolio,
  markPosition,
  markPriceForSide,
  unrealisedPnlUsd,
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

/**
 * True when any specialist lot would sell on this quote after marking.
 * Lets the live loop interrupt the 15-minute cadence for a specialist stop
 * even when the swarm book is flat or not yet at its own floor.
 */
export function anySpecialistStopHit(
  state: LivePaperMarketState,
  quote: FullQuote,
  now: Date,
): boolean {
  for (const agent of REPLAY_SPECIALISTS) {
    const position = state.specialistPortfolios[agent]?.position;
    if (!position) continue;
    const marked = markPosition(position, quote).position;
    const hit = exitHitReason(
      marked,
      markPriceForSide(marked.side, quote),
      unrealisedPnlUsd(marked, quote),
      now,
    );
    if (hit !== null) return true;
  }
  return false;
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
    const specialistForceClose = Boolean(portfolio.position) && forceClose;
    let proposed = proposeFromStance({
      stance,
      position: portfolio.position,
      forceClose: specialistForceClose,
      quote,
      now: at,
    });

    // New entries are blocked on incoherent / illiquid quotes so the agent is
    // graded on its prediction, not on spread damage. A force-close pass (the
    // market has closed or settled) must also never open a fresh position.
    if (proposed.startsWith('buy_')) {
      const blockReason = forceClose
        ? 'entry_gate: market closing — no new specialist entries'
        : entryBlockReason({
            buyYesPriceUsd: quote.buyYesPriceUsd,
            buyNoPriceUsd: quote.buyNoPriceUsd,
            liquidityScore: point.context.features.liquidityScore,
          });
      if (blockReason) {
        proposed = 'hold';
      }
    }

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
        // Captured NOW so the closed-trade audit shows what the agent believed
        // when it entered, not whatever stance later triggered the exit.
        swarmStateAtEntry: {
          recommendation:
            stance === 'yes' ? 'buy_yes' : stance === 'no' ? 'buy_no' : 'hold',
          confidence: signal?.confidence ?? 0,
          approved: true,
          signals: replayed.signals,
        },
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
        swarmStateAtEntry: entryMeta.swarmStateAtEntry ?? {
          recommendation: soldSlice.side === 'yes' ? 'buy_yes' : 'buy_no',
          confidence: entryMeta.stanceConfidence,
          approved: true,
          signals: [],
        },
        resolvedTo,
        exitReason: closedExitReason(
          specialistForceClose,
          before,
          markPriceForSide(before.side, quote),
          unrealisedPnlUsd(before, quote),
          at,
        ),
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
