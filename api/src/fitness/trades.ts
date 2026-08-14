import { getAgentWeightMap } from '../adaptive/index.js';
import type { PaperDecisionRecord, PaperMarketHistory } from '../backtest/index.js';
import type { AgentName, Stance } from '../schemas/index.js';
import { entryBlockReason } from '../trading/entry-gate.js';
import { closedExitReason, exitHitReason } from '../trading/exit-gate.js';
import {
  applyPaperAction,
  emptyPortfolio,
  holdingMinutes,
  markPosition,
  markPriceForSide,
  unrealisedPnlUsd,
} from '../trading/paper.js';
import type { FullQuote, PaperAction, PaperPortfolio } from '../trading/paper-types.js';
import type { CompletedFitnessTrade, TradeOwner } from './types.js';

/**
 * Turn paper-replay histories into coherent fitness trades.
 *
 * Swarm trades come from ClosedPaperTrade records the replay engine already
 * emitted. Specialist trades come from a separate unit-stake paper book driven
 * only by that specialist's stance at each decision — still coherent positions,
 * never one "trade" per observation.
 */

const SWARM_OWNER: TradeOwner = 'swarm';

/** Snapshot of Phase 6 weights currently published (empty → null). */
function snapshotAdaptiveWeights(): Partial<Record<AgentName, number>> | null {
  const map = getAgentWeightMap();
  const entries = Object.entries(map).filter(
    (entry): entry is [AgentName, number] =>
      typeof entry[1] === 'number' && Number.isFinite(entry[1]),
  );
  if (entries.length === 0) {
    return null;
  }
  return Object.fromEntries(entries) as Partial<Record<AgentName, number>>;
}

/** Quote legs stored on each decision row. */
function quoteFromDecision(decision: PaperDecisionRecord): FullQuote {
  return {
    buyYesPriceUsd: decision.yesPriceUsd,
    buyNoPriceUsd: decision.noPriceUsd,
    sellYesPriceUsd: decision.sellYesPriceUsd,
    sellNoPriceUsd: decision.sellNoPriceUsd,
  };
}

/** Map a specialist stance onto a paper action given current inventory. */
export function proposeFromStance(options: {
  stance: Stance;
  position: PaperPortfolio['position'];
  forceClose?: boolean;
  quote?: FullQuote;
  now?: Date;
}): PaperAction {
  const { stance, position, forceClose = false, quote, now } = options;

  if (forceClose && position) {
    return position.side === 'yes' ? 'sell_yes' : 'sell_no';
  }

  if (!position) {
    if (stance === 'yes') return 'buy_yes';
    if (stance === 'no') return 'buy_no';
    return 'hold';
  }

  if (quote) {
    const mark = markPriceForSide(position.side, quote);
    const unrealised = unrealisedPnlUsd(position, quote);
    if (exitHitReason(position, mark, unrealised, now ?? new Date()) !== null) {
      return position.side === 'yes' ? 'sell_yes' : 'sell_no';
    }
  }

  if (position.side === 'yes') {
    return stance === 'no' ? 'sell_yes' : 'hold';
  }
  return stance === 'yes' ? 'sell_no' : 'hold';
}

function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function conditionsFromDecision(decision: PaperDecisionRecord) {
  return {
    yesPriceUsd: decision.yesPriceUsd,
    noPriceUsd: decision.noPriceUsd,
    liquidityScore: decision.features.liquidityScore,
    hoursToClose: decision.features.hoursToClose,
    hadOrderbook: decision.contextSummary.hadOrderbook,
    change5m: decision.contextSummary.change5m,
    volatility: decision.contextSummary.volatility,
  };
}

function swarmStateFromDecision(decision: PaperDecisionRecord) {
  return {
    recommendation: decision.swarmRecommendation,
    confidence: decision.confidence,
    approved: decision.approved,
    signals: decision.signals.map((signal) => ({
      agent: signal.agent,
      stance: signal.stance,
      confidence: signal.confidence,
    })),
  };
}

/** Convert swarm closed-trade records into the fitness trade shape. */
export function swarmTradesFromHistory(
  history: PaperMarketHistory,
): CompletedFitnessTrade[] {
  return history.closedTrades.map((trade) => ({
    marketId: trade.marketId,
    owner: SWARM_OWNER,
    entryAt: trade.entryAt,
    entryPriceUsd: trade.entryPriceUsd,
    exitAt: trade.exitAt,
    exitPriceUsd: trade.exitPriceUsd,
    side: trade.side,
    quantity: trade.quantity,
    sizeUsd: trade.sizeUsd,
    grossPnlUsd: trade.grossPnlUsd,
    estimatedCostUsd: trade.estimatedCostUsd,
    netPnlUsd: trade.netPnlUsd,
    holdingMinutes: trade.holdingMinutes,
    mfeUsd: trade.mfeUsd,
    maeUsd: trade.maeUsd,
    entryConditions: trade.entryConditions,
    exitConditions: trade.exitConditions,
    swarmStateAtEntry: {
      recommendation: trade.swarmStateAtEntry.recommendation,
      confidence: trade.swarmStateAtEntry.confidence,
      approved: trade.swarmStateAtEntry.approved,
      signals: trade.swarmStateAtEntry.signals.map((signal) => ({
        agent: signal.agent,
        stance: signal.stance,
        confidence: signal.confidence,
      })),
    },
    // Resolution is kept for context; net P&L already locked at exit.
    resolvedTo: trade.resolvedTo,
    adaptiveWeightsAtEntry: snapshotAdaptiveWeights(),
    exitReason: trade.exitReason,
  }));
}

/**
 * Simulate one specialist's paper book from an already-replayed market history.
 *
 * Reuses the chronological decision points and quotes — no look-ahead beyond
 * what the swarm paper book already saw.
 */
export function simulateSpecialistTrades(
  history: PaperMarketHistory,
  agent: AgentName,
  stakeUsd: number,
): CompletedFitnessTrade[] {
  let portfolio: PaperPortfolio = emptyPortfolio();
  const closed: CompletedFitnessTrade[] = [];

  let entryQuote: FullQuote | null = null;
  let entryDecision: PaperDecisionRecord | null = null;
  let entryWeights: Partial<Record<AgentName, number>> | null = null;

  for (let index = 0; index < history.decisions.length; index += 1) {
    const decision = history.decisions[index];
    if (!decision) continue;

    const quote = quoteFromDecision(decision);
    const at = new Date(decision.timestamp);
    const isLast = index === history.decisions.length - 1;

    if (portfolio.position) {
      const marked = markPosition(portfolio.position, quote);
      portfolio = { ...portfolio, position: marked.position };
    }

    const signal = decision.signals.find((entry) => entry.agent === agent);
    const stance: Stance = signal?.stance ?? 'neutral';
    const forceClose = Boolean(portfolio.position) && isLast;
    let proposed = proposeFromStance({
      stance,
      position: portfolio.position,
      forceClose,
      quote,
      now: at,
    });

    // Same entry gate the live loop applies: skip entries on incoherent or
    // illiquid quotes so offline fitness grades predictions, not spread damage.
    if (
      proposed.startsWith('buy_') &&
      entryBlockReason({
        buyYesPriceUsd: decision.yesPriceUsd,
        buyNoPriceUsd: decision.noPriceUsd,
        liquidityScore: decision.features.liquidityScore,
      }) !== null
    ) {
      proposed = 'hold';
    }

    const before = portfolio.position;
    const applied = applyPaperAction(portfolio, proposed, quote, at, stakeUsd, {
      book: decision.depthBook,
      execution: history.options.execution,
    });
    portfolio = applied.portfolio;

    if (applied.appliedAction.startsWith('buy_') && applied.rejectionReason === null) {
      entryQuote = quote;
      entryDecision = decision;
      entryWeights = snapshotAdaptiveWeights();
    }

    if (
      applied.appliedAction.startsWith('sell_') &&
      applied.rejectionReason === null &&
      before &&
      entryQuote &&
      entryDecision &&
      applied.fillPriceUsd !== null &&
      applied.filledContracts > 0
    ) {
      const soldFraction = applied.filledContracts / before.contracts;
      const soldContracts = applied.filledContracts;
      const soldSizeUsd = toCents(before.sizeUsd * soldFraction);
      const entryMid =
        before.side === 'yes'
          ? (entryQuote.buyYesPriceUsd + entryQuote.sellYesPriceUsd) / 2
          : (entryQuote.buyNoPriceUsd + entryQuote.sellNoPriceUsd) / 2;
      const exitMid =
        before.side === 'yes'
          ? (quote.buyYesPriceUsd + quote.sellYesPriceUsd) / 2
          : (quote.buyNoPriceUsd + quote.sellNoPriceUsd) / 2;
      const grossPnlUsd = toCents(soldContracts * (exitMid - entryMid));
      const netPnlUsd = applied.stepRealisedPnlUsd;
      const mark = markPriceForSide(before.side, quote);
      const unrealised = unrealisedPnlUsd(before, quote);

      closed.push({
        marketId: history.marketId,
        owner: agent,
        entryAt: before.entryAt,
        entryPriceUsd: before.entryPriceUsd,
        exitAt: at.toISOString(),
        exitPriceUsd: applied.fillPriceUsd,
        side: before.side,
        quantity: soldContracts,
        sizeUsd: soldSizeUsd,
        grossPnlUsd,
        estimatedCostUsd: toCents(grossPnlUsd - netPnlUsd),
        netPnlUsd,
        holdingMinutes: holdingMinutes(before.entryAt, at),
        mfeUsd: before.mfeUsd,
        maeUsd: before.maeUsd,
        entryConditions: conditionsFromDecision(entryDecision),
        exitConditions: conditionsFromDecision(decision),
        swarmStateAtEntry: swarmStateFromDecision(entryDecision),
        resolvedTo: history.resolvedTo,
        adaptiveWeightsAtEntry: entryWeights,
        exitReason: closedExitReason(forceClose, before, mark, unrealised, at),
      });

      if (!applied.residualPosition) {
        entryQuote = null;
        entryDecision = null;
        entryWeights = null;
      }
    }
  }

  return closed;
}

/** Collect swarm + specialist trades from every paper-replayed market. */
export function collectFitnessTrades(
  histories: PaperMarketHistory[],
  specialistStakeUsd: number,
): {
  swarmTrades: CompletedFitnessTrade[];
  byAgent: Map<AgentName, CompletedFitnessTrade[]>;
} {
  const swarmTrades: CompletedFitnessTrade[] = [];
  const byAgent = new Map<AgentName, CompletedFitnessTrade[]>();

  for (const history of histories) {
    swarmTrades.push(...swarmTradesFromHistory(history));

    const agents = new Set<AgentName>();
    for (const decision of history.decisions) {
      for (const signal of decision.signals) {
        agents.add(signal.agent);
      }
    }

    for (const agent of agents) {
      const trades = simulateSpecialistTrades(history, agent, specialistStakeUsd);
      if (trades.length === 0) continue;
      const existing = byAgent.get(agent) ?? [];
      existing.push(...trades);
      byAgent.set(agent, existing);
    }
  }

  return { swarmTrades, byAgent };
}
