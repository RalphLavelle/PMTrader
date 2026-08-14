import { configuredRiskLimits } from '../agents/risk-manager/limits.js';
import type { DecisionPoint } from '../backtest/history.js';
import { replayDecision } from '../backtest/replay.js';
import { effectiveCategories } from '../collector/category-filter.js';
import { loadSchedule } from '../collector/schedule.js';
import {
  getMarketSnapshots,
  getOrderbookSnapshots,
  listOpenTrackedMarketIds,
} from '../collector/store.js';
import { loadWatchlist } from '../shared/watchlist.js';
import type {
  MarketSnapshotDoc,
  OrderbookSnapshotDoc,
  TradeDoc,
} from '../collector/types.js';
import { config } from '../config.js';
import { asOfOrderbook } from '../features/builder.js';
import { buildMarketContextAt } from '../features/context.js';
import { loadLabel, loadTrades } from '../features/coverage.js';
import { reconstructSnapshot } from '../features/reconstruct.js';
import type { CompletedFitnessTrade } from '../fitness/types.js';
import { refreshAdaptiveFromLiveTrades } from '../adaptive/index.js';
import type { AgentName } from '../schemas/index.js';
import type { ClosedPaperTrade } from '../backtest/paper-types.js';
import { resolveExecutionOptions } from './fill-model.js';
import { buildClosedPaperTrade } from './closed-trade.js';
import { entryBlockReason } from './entry-gate.js';
import { closedExitReason, exitHitReason } from './exit-gate.js';
import {
  applyPaperAction,
  fullQuoteFrom,
  markPosition,
  markPriceForSide,
  proposePaperAction,
  unrealisedPnlUsd,
} from './paper.js';
import type { FullQuote, PaperAction } from './paper-types.js';
import * as log from './live-log.js';
import {
  advanceSpecialistBooks,
  anySpecialistStopHit,
  snapshotWeights,
  tipTradeConditions,
} from './live-specialists.js';
import type {
  LiveClosedTradeDoc,
  LiveEntryMeta,
  LivePaperPassResult,
  PaperIntent,
} from './live-types.js';
import {
  createEmptyMarketState,
  insertClosedTrades,
  insertDecision,
  listOpenPositionMarketIds,
  loadMarketState,
  saveMarketState,
} from './live-store.js';

/**
 * Continuous paper-trading engine.
 *
 * Same decision path as historical paper replay (`replayDecision` → propose →
 * apply), fed by collector tips. PAPER ONLY — never places real orders.
 */

function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function depthBookFrom(
  book: { yesDollars: Array<[string, number]>; noDollars: Array<[string, number]> } | null,
) {
  if (!book) return null;
  return { yesDollars: book.yesDollars ?? [], noDollars: book.noDollars ?? [] };
}

function classifyIntent(
  proposed: PaperAction,
  applied: PaperAction,
  hadPosition: boolean,
  residual: boolean,
): PaperIntent {
  if (applied.startsWith('sell_')) {
    return residual ? 'reduce' : 'exit';
  }
  if (applied.startsWith('buy_')) {
    return hadPosition ? 'add' : 'enter';
  }
  if (proposed.startsWith('buy_') && hadPosition) {
    return 'add';
  }
  return 'hold';
}

function fitnessFromClosed(
  trade: ClosedPaperTrade,
  owner: AgentName | 'swarm',
  weights: Partial<Record<AgentName, number>> | null,
): CompletedFitnessTrade {
  return {
    marketId: trade.marketId,
    owner,
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
    swarmStateAtEntry: trade.swarmStateAtEntry,
    resolvedTo: trade.resolvedTo,
    adaptiveWeightsAtEntry: weights,
    exitReason: trade.exitReason,
  };
}

/** Newest-first load, then reverse so context builders see oldest → newest. */
async function loadRecentHistory(marketId: string, limit: number): Promise<{
  snapshots: MarketSnapshotDoc[];
  orderbooks: OrderbookSnapshotDoc[];
  trades: TradeDoc[];
}> {
  const [newestSnaps, newestBooks, trades] = await Promise.all([
    getMarketSnapshots()
      .find({ marketId })
      .sort({ capturedAt: -1 })
      .limit(limit)
      .toArray(),
    getOrderbookSnapshots()
      .find({ marketId })
      .sort({ capturedAt: -1 })
      .limit(limit)
      .toArray(),
    loadTrades({ marketId, limit, ascending: true }),
  ]);

  return {
    snapshots: [...newestSnaps].reverse(),
    orderbooks: [...newestBooks].reverse(),
    trades,
  };
}

/** Build the same DecisionPoint shape historical replay uses, at the tip. */
function tipDecisionPoint(
  snapshots: MarketSnapshotDoc[],
  orderbooks: OrderbookSnapshotDoc[],
  trades: TradeDoc[],
): DecisionPoint | null {
  const tip = snapshots[snapshots.length - 1];
  if (!tip) return null;

  const atMs = tip.capturedAt.getTime();
  const book = asOfOrderbook(orderbooks, atMs);
  const snapshot = reconstructSnapshot(tip, book);
  const context = buildMarketContextAt({
    at: tip.capturedAt,
    snapshots,
    orderbooks,
    trades: trades.filter((row) => row.timestamp.getTime() <= atMs),
    liveSnapshot: snapshot,
    openTime: tip.openTime ?? null,
  });

  return {
    snapshot: context.snapshot,
    hadOrderbook: context.meta.hadOrderbook,
    context,
    orderbook: book,
  };
}

/** Markets to visit: shared watchlist (depth is collected there) plus open paper books. */
export async function resolvePaperUniverse(): Promise<string[]> {
  const watch = await loadWatchlist();
  const withPositions = await listOpenPositionMarketIds();

  // When the watchlist is empty (collector off / size 0), fall back to open
  // tracked markets so paper is not completely stuck.
  let preferred = watch;
  if (preferred.length === 0) {
    const schedule = await loadSchedule();
    const categories = effectiveCategories(schedule.streams.market_snapshots.options);
    preferred = await listOpenTrackedMarketIds(
      categories,
      config.paperTradingMaxMarkets,
    );
  }

  return [
    ...new Set([
      ...preferred.slice(0, config.paperTradingMaxMarkets),
      ...withPositions,
    ]),
  ];
}

type MarketTickResult = {
  closed: CompletedFitnessTrade[];
  entry: boolean;
  exit: boolean;
  reject: boolean;
  veto: boolean;
  stale: boolean;
  duplicate: boolean;
  skipped: boolean;
};

const SKIP: MarketTickResult = {
  closed: [],
  entry: false,
  exit: false,
  reject: false,
  veto: false,
  stale: false,
  duplicate: false,
  skipped: true,
};

/** Process one market tip through the paper book. */
export async function processLivePaperMarket(
  marketId: string,
): Promise<MarketTickResult> {
  const history = await loadRecentHistory(marketId, 500);
  const point = tipDecisionPoint(
    history.snapshots,
    history.orderbooks,
    history.trades,
  );
  if (!point) {
    return SKIP;
  }

  const tip = history.snapshots[history.snapshots.length - 1]!;
  const observationAt = tip.capturedAt.toISOString();
  const ageMs = Date.now() - tip.capturedAt.getTime();
  const quote: FullQuote = fullQuoteFrom(point.snapshot);
  const depthBook = depthBookFrom(point.orderbook);
  const execution = resolveExecutionOptions();
  const label = await loadLabel(marketId);
  const resolvedTo =
    label?.result === 'yes' || label?.result === 'no' ? label.result : null;

  let state =
    (await loadMarketState(marketId)) ??
    createEmptyMarketState(marketId, tip.title, tip.status);
  state = { ...state, title: tip.title, marketStatus: tip.status };

  // Duplicate observation — mark position only.
  if (
    state.lastContentHash === tip.contentHash &&
    state.lastObservationAt === observationAt
  ) {
    if (state.portfolio.position) {
      const marked = markPosition(state.portfolio.position, quote);
      state = {
        ...state,
        portfolio: { ...state.portfolio, position: marked.position },
        unrealisedPnlUsd: marked.unrealisedPnlUsd,
      };
      await saveMarketState(state);
    }
    return { ...SKIP, duplicate: true };
  }

  const marketClosed = tip.status !== 'open';
  const stale = !marketClosed && ageMs > config.paperTradingStaleMs;
  /**
   * A stale market that has already resolved will never get fresher data, so
   * skipping it forever leaves zombie positions that never become learning
   * evidence (positions were observed held 950–1,600+ minutes against a
   * 15-minute cadence). Fall through and force-close at the last known quote.
   */
  const settleStale = stale && resolvedTo !== null;

  if (state.portfolio.position) {
    const marked = markPosition(state.portfolio.position, quote);
    state = {
      ...state,
      portfolio: { ...state.portfolio, position: marked.position },
      unrealisedPnlUsd: marked.unrealisedPnlUsd,
    };
  } else {
    state = { ...state, unrealisedPnlUsd: null };
  }

  const at = new Date(point.context.at);
  const swarmStop =
    state.portfolio.position !== null &&
    exitHitReason(
      state.portfolio.position,
      markPriceForSide(state.portfolio.position.side, quote),
      unrealisedPnlUsd(state.portfolio.position, quote),
      at,
    ) !== null;
  const stopDue = swarmStop || anySpecialistStopHit(state, quote, at);

  const decisionIntervalMs =
    Math.max(1, config.paperTradingDecisionIntervalMinutes) * 60_000;
  const lastDecisionMs = state.lastDecisionAt
    ? Date.parse(state.lastDecisionAt)
    : Number.NEGATIVE_INFINITY;
  const dueForDecision =
    marketClosed ||
    settleStale ||
    stopDue ||
    !Number.isFinite(lastDecisionMs) ||
    Date.now() - lastDecisionMs >= decisionIntervalMs;

  // Stale quotes skip new entries / flips, but a stop that already printed
  // on the last bid still sells — waiting for a fresh tip just holds the loss.
  if (stale && !marketClosed && !settleStale && !stopDue) {
    log.logStaleData(marketId, ageMs, config.paperTradingStaleMs);
    state = {
      ...state,
      lastObservationAt: observationAt,
      lastContentHash: tip.contentHash,
    };
    await saveMarketState(state);
    await insertDecision({
      marketId,
      timestamp: new Date().toISOString(),
      observationAt,
      intent: 'hold',
      proposedAction: 'hold',
      appliedAction: 'hold',
      rejectionReason: 'stale_data',
      vetoReasons: [],
      approved: false,
      confidence: 0,
      recommendation: 'hold',
      filledSizeUsd: 0,
      rejectedSizeUsd: 0,
      fillPriceUsd: null,
      realisedPnlUsd: null,
      unrealisedPnlUsd: state.unrealisedPnlUsd,
      cumulativeRealisedPnlUsd: state.portfolio.realisedPnlUsd,
      position: state.portfolio.position,
      stale: true,
      duplicateObservation: false,
    });
    return { ...SKIP, stale: true };
  }

  if (!dueForDecision && !marketClosed) {
    state = {
      ...state,
      lastObservationAt: observationAt,
      lastContentHash: tip.contentHash,
    };
    await saveMarketState(state);
    return SKIP;
  }

  const limits = {
    ...configuredRiskLimits,
    // PAPER ONLY: a lower evidence-gathering threshold than real money uses.
    // At swarmMinConfidence (0.55) the structural trend/mean-reversion
    // disagreement vetoed nearly every entry and the book never learned.
    minConfidence: config.paperTradingMinConfidence,
  };
  const replayed = replayDecision(point, limits);
  const settling = marketClosed || settleStale;
  const forceClose = Boolean(state.portfolio.position) && settling;
  let proposedAction = proposePaperAction({
    recommendation: replayed.recommendation,
    approved: replayed.approved,
    position: state.portfolio.position,
    forceClose,
    quote,
    now: at,
  });

  // Entry gate: never open on incoherent / illiquid quotes, and never open
  // while settling a closed or resolved-but-stale market.
  let entryGateReason: string | null = null;
  if (proposedAction.startsWith('buy_')) {
    entryGateReason = settling
      ? 'entry_gate: market closing — no new entries'
      : entryBlockReason({
          buyYesPriceUsd: quote.buyYesPriceUsd,
          buyNoPriceUsd: quote.buyNoPriceUsd,
          liquidityScore: point.context.features.liquidityScore,
        });
    if (entryGateReason) {
      log.logRejectedTrade(marketId, proposedAction, entryGateReason);
      proposedAction = 'hold';
    }
  }

  const hadPosition = Boolean(state.portfolio.position);
  const sizeUsd = replayed.approved ? replayed.positionSizeUsd : 0;
  const positionBefore = state.portfolio.position;
  const entryMetaBefore = state.entryMeta;

  const applied = applyPaperAction(
    state.portfolio,
    proposedAction,
    quote,
    at,
    sizeUsd,
    { book: depthBook, execution },
  );

  state = {
    ...state,
    portfolio: applied.portfolio,
    lastObservationAt: observationAt,
    lastContentHash: tip.contentHash,
    lastDecisionAt: new Date().toISOString(),
  };

  if (state.portfolio.position) {
    const marked = markPosition(state.portfolio.position, quote);
    state = {
      ...state,
      portfolio: { ...state.portfolio, position: marked.position },
      unrealisedPnlUsd: marked.unrealisedPnlUsd,
    };
  } else {
    state = { ...state, unrealisedPnlUsd: null };
  }

  const intent = classifyIntent(
    proposedAction,
    applied.appliedAction,
    hadPosition,
    Boolean(applied.residualPosition),
  );

  const closedFitness: CompletedFitnessTrade[] = [];
  const closedDocs: Array<
    Omit<LiveClosedTradeDoc, 'id' | 'createdAt' | 'source'>
  > = [];

  let entry = false;
  let exit = false;
  let reject = false;
  const veto = !replayed.approved && replayed.vetoReasons.length > 0;

  if (veto) {
    log.logRiskVeto(marketId, replayed.vetoReasons);
  }
  if (applied.rejectionReason) {
    reject = true;
    log.logRejectedTrade(marketId, proposedAction, applied.rejectionReason);
  }

  if (applied.appliedAction.startsWith('buy_') && !applied.rejectionReason) {
    entry = true;
    const meta: LiveEntryMeta = {
      entryQuote: quote,
      entryConditions: tipTradeConditions(quote, point),
      swarmStateAtEntry: {
        recommendation: replayed.recommendation,
        confidence: replayed.confidence,
        approved: replayed.approved,
        signals: replayed.signals,
      },
      adaptiveWeightsAtEntry: snapshotWeights(),
    };
    state = { ...state, entryMeta: meta };
    log.logEntry(
      marketId,
      applied.appliedAction.replace('buy_', ''),
      applied.filledSizeUsd,
      applied.fillPriceUsd ?? 0,
    );
  }

  if (
    applied.appliedAction.startsWith('sell_') &&
    !applied.rejectionReason &&
    positionBefore &&
    entryMetaBefore &&
    applied.fillPriceUsd !== null &&
    applied.filledContracts > 0
  ) {
    exit = true;
    const soldFraction = applied.filledContracts / positionBefore.contracts;
    const soldSlice = {
      ...positionBefore,
      contracts: applied.filledContracts,
      sizeUsd: toCents(positionBefore.sizeUsd * soldFraction),
    };
    const closed = buildClosedPaperTrade({
      marketId,
      position: soldSlice,
      entryQuote: entryMetaBefore.entryQuote,
      exitQuote: quote,
      exitPriceUsd: applied.fillPriceUsd,
      exitAt: at,
      netPnlUsd: applied.stepRealisedPnlUsd,
      entryConditions: entryMetaBefore.entryConditions,
      exitConditions: tipTradeConditions(quote, point),
      swarmStateAtEntry: entryMetaBefore.swarmStateAtEntry,
      resolvedTo,
      exitReason: closedExitReason(
        forceClose,
        positionBefore,
        markPriceForSide(positionBefore.side, quote),
        unrealisedPnlUsd(positionBefore, quote),
        at,
      ),
    });
    closedDocs.push({
      ...closed,
      owner: 'swarm',
      adaptiveWeightsAtEntry: entryMetaBefore.adaptiveWeightsAtEntry,
    });
    closedFitness.push(
      fitnessFromClosed(closed, 'swarm', entryMetaBefore.adaptiveWeightsAtEntry),
    );
    log.logExit(
      marketId,
      positionBefore.side,
      applied.stepRealisedPnlUsd,
      applied.fillPriceUsd,
      Boolean(applied.residualPosition),
      closed.exitReason,
    );
    log.logPnl(marketId, state.portfolio.realisedPnlUsd, state.unrealisedPnlUsd);
    if (!applied.residualPosition) {
      state = { ...state, entryMeta: null };
    }
  }

  const specialistClosed = advanceSpecialistBooks({
    state,
    point,
    quote,
    depthBook,
    execution,
    forceClose: settling,
    resolvedTo,
  });
  state = specialistClosed.state;
  for (const trade of specialistClosed.closed) {
    closedDocs.push({
      ...trade.closed,
      owner: trade.owner,
      adaptiveWeightsAtEntry: trade.weights,
    });
    closedFitness.push(
      fitnessFromClosed(trade.closed, trade.owner, trade.weights),
    );
  }

  await saveMarketState(state);
  await insertDecision({
    marketId,
    timestamp: state.lastDecisionAt ?? new Date().toISOString(),
    observationAt,
    intent,
    proposedAction,
    appliedAction: applied.appliedAction,
    rejectionReason: applied.rejectionReason ?? entryGateReason,
    vetoReasons: replayed.vetoReasons,
    approved: replayed.approved,
    confidence: replayed.confidence,
    recommendation: replayed.recommendation,
    filledSizeUsd: applied.filledSizeUsd,
    rejectedSizeUsd: applied.rejectedSizeUsd,
    fillPriceUsd: applied.fillPriceUsd,
    realisedPnlUsd:
      applied.stepRealisedPnlUsd !== 0 ? applied.stepRealisedPnlUsd : null,
    unrealisedPnlUsd: state.unrealisedPnlUsd,
    cumulativeRealisedPnlUsd: state.portfolio.realisedPnlUsd,
    position: state.portfolio.position,
    stale: false,
    duplicateObservation: false,
  });

  if (closedDocs.length > 0) {
    await insertClosedTrades(closedDocs);
  }

  return {
    closed: closedFitness,
    entry,
    exit,
    reject,
    veto,
    stale: false,
    duplicate: false,
    skipped: false,
  };
}

/** One full pass over the paper universe. */
export async function runLivePaperPass(): Promise<LivePaperPassResult> {
  const startedAt = new Date();
  const errors: string[] = [];
  let marketsProcessed = 0;
  let skippedStale = 0;
  let skippedDuplicate = 0;
  let entries = 0;
  let exits = 0;
  let rejects = 0;
  let riskVetoes = 0;
  let closedTrades = 0;
  const allClosed: CompletedFitnessTrade[] = [];

  let marketIds: string[] = [];
  try {
    marketIds = await resolvePaperUniverse();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'universe failed');
  }

  for (const marketId of marketIds) {
    try {
      const result = await processLivePaperMarket(marketId);
      if (!result.skipped) marketsProcessed += 1;
      if (result.stale) skippedStale += 1;
      if (result.duplicate) skippedDuplicate += 1;
      if (result.entry) entries += 1;
      if (result.exit) exits += 1;
      if (result.reject) rejects += 1;
      if (result.veto) riskVetoes += 1;
      closedTrades += result.closed.length;
      allClosed.push(...result.closed);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      errors.push(`${marketId}: ${message}`);
      console.error(`[paper] Failed ${marketId}: ${message}`);
    }
  }

  if (allClosed.length > 0) {
    try {
      const table = refreshAdaptiveFromLiveTrades(allClosed);
      log.logAdaptiveWeightUpdate(
        table.agents.map((row) => ({
          agent: row.agent,
          weight: row.currentWeight,
          sampleCount: row.sampleCount,
        })),
      );
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : 'adaptive refresh failed',
      );
    }
  }

  const finishedAt = new Date();
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    marketsConsidered: marketIds.length,
    marketsProcessed,
    skippedStale,
    skippedDuplicate,
    entries,
    exits,
    rejects,
    riskVetoes,
    closedTrades,
    errors,
  };
}
