import { configuredRiskLimits } from '../agents/risk-manager/limits.js';
import type { RiskLimits } from '../agents/risk-manager/logic.js';
import type { MarketContext } from '../features/context.js';
import {
  listTradableMarkets,
  loadLabel,
  loadMarketOrderbooks,
  loadMarketSnapshots,
  loadTrades,
} from '../features/coverage.js';
import { connectMongo } from '../memory/mongodb.client.js';
import type { DepthBook } from '../trading/execution-types.js';
import { resolveExecutionOptions } from '../trading/fill-model.js';
import { buildClosedPaperTrade } from '../trading/closed-trade.js';
import { closedExitReason } from '../trading/exit-gate.js';
import {
  applyPaperAction,
  emptyPortfolio,
  fullQuoteFrom,
  holdingMinutes,
  markPosition,
  markPriceForSide,
  paperFillPrice,
  proposePaperAction,
  unrealisedPnlUsd,
} from '../trading/paper.js';
import type { FullQuote, PaperAction, PaperPortfolio, PaperSide } from '../trading/paper-types.js';
import { resolveOptions } from './engine.js';
import { enrichMarketLabelFields } from './enrich-markets.js';
import { buildDecisionPoints } from './history.js';
import type {
  ClosedPaperTrade,
  PaperDecisionRecord,
  PaperMarketHistory,
  PaperReplayOptions,
  PaperReplaySummary,
  PaperTradeConditions,
} from './paper-types.js';
import { replayDecision } from './replay.js';

/**
 * Intramarket historical paper-replay engine.
 *
 * Fills use the conservative execution model (ask/bid, depth, slippage, fees)
 * — never mid-price execution.
 */

/** Bound paper-replay options (shares Phase 4 defaults where applicable). */
export function resolvePaperOptions(
  overrides?: Partial<PaperReplayOptions>,
): PaperReplayOptions {
  const base = resolveOptions({
    maxMarkets: overrides?.maxMarkets,
    decisionIntervalMinutes: overrides?.decisionIntervalMinutes,
    minSnapshots: overrides?.minSnapshots,
    maxSnapshotsPerMarket: overrides?.maxSnapshotsPerMarket,
    minConfidence: overrides?.minConfidence,
    requireOrderbook: overrides?.requireOrderbook,
  });

  return {
    maxMarkets: base.maxMarkets,
    decisionIntervalMinutes: base.decisionIntervalMinutes,
    minSnapshots: base.minSnapshots,
    maxSnapshotsPerMarket: base.maxSnapshotsPerMarket,
    minConfidence: base.minConfidence,
    requireOrderbook: base.requireOrderbook,
    execution: resolveExecutionOptions(overrides?.execution),
  };
}

function limitsFor(options: PaperReplayOptions): RiskLimits {
  return { ...configuredRiskLimits, minConfidence: options.minConfidence };
}

function sideFromAction(action: PaperAction): PaperSide | null {
  if (action === 'buy_yes' || action === 'sell_yes') {
    return 'yes';
  }
  if (action === 'buy_no' || action === 'sell_no') {
    return 'no';
  }
  return null;
}

function depthBookFrom(
  book: { yesDollars: Array<[string, number]>; noDollars: Array<[string, number]> } | null,
): DepthBook | null {
  if (!book) {
    return null;
  }
  return {
    yesDollars: book.yesDollars ?? [],
    noDollars: book.noDollars ?? [],
  };
}

function summariseContext(context: MarketContext): PaperDecisionRecord['contextSummary'] {
  return {
    at: context.at,
    historyPoints: context.meta.historyPoints,
    hadOrderbook: context.meta.hadOrderbook,
    change5m: context.trajectory.change5m,
    volatility: context.trajectory.volatility,
    tradeCount: context.tradeFlow.tradeCount,
    hoursToClose: context.features.hoursToClose,
  };
}

function tradeConditions(
  quote: FullQuote,
  context: MarketContext,
): PaperTradeConditions {
  return {
    yesPriceUsd: quote.buyYesPriceUsd,
    noPriceUsd: quote.buyNoPriceUsd,
    liquidityScore: context.features.liquidityScore,
    hoursToClose: context.features.hoursToClose,
    hadOrderbook: context.meta.hadOrderbook,
    change5m: context.trajectory.change5m,
    volatility: context.trajectory.volatility,
  };
}

function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Chronologically paper-trade one market (oldest → newest). */
export async function paperReplayMarket(
  marketId: string,
  title: string,
  options: PaperReplayOptions,
  includeFullContext = false,
): Promise<PaperMarketHistory | null> {
  const [snapshots, orderbooks, trades, label] = await Promise.all([
    loadMarketSnapshots(marketId, options.maxSnapshotsPerMarket),
    loadMarketOrderbooks(marketId, options.maxSnapshotsPerMarket),
    loadTrades({ marketId, limit: options.maxSnapshotsPerMarket, ascending: true }),
    loadLabel(marketId),
  ]);

  if (snapshots.length < options.minSnapshots) {
    return null;
  }

  const points = buildDecisionPoints(
    snapshots,
    orderbooks,
    options.decisionIntervalMinutes,
    trades,
  );

  if (points.length === 0) {
    return null;
  }

  const limits = limitsFor(options);
  const resolvedTo =
    label?.result === 'yes' || label?.result === 'no' ? label.result : null;
  const execution = resolveExecutionOptions(options.execution);

  let portfolio: PaperPortfolio = emptyPortfolio();
  const decisions: PaperDecisionRecord[] = [];
  const closedTrades: ClosedPaperTrade[] = [];
  let buys = 0;
  let sells = 0;
  let holds = 0;
  let rejectedActions = 0;

  let entryQuote: FullQuote | null = null;
  let entryConditions: PaperTradeConditions | null = null;
  let swarmStateAtEntry: ClosedPaperTrade['swarmStateAtEntry'] | null = null;

  const startedAt = new Date().toISOString();

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point) {
      continue;
    }

    if (options.requireOrderbook && !point.hadOrderbook) {
      continue;
    }

    const at = new Date(point.context.at);
    const quote: FullQuote = fullQuoteFrom(point.snapshot);
    const depthBook = depthBookFrom(point.orderbook);
    const isLast = index === points.length - 1;
    const marketClosed = point.snapshot.status !== 'open';

    let unrealised: number | null = null;
    if (portfolio.position) {
      const marked = markPosition(portfolio.position, quote);
      portfolio = { ...portfolio, position: marked.position };
      unrealised = marked.unrealisedPnlUsd;
    }

    const replayed = replayDecision(point, limits);
    const forceClose = Boolean(portfolio.position) && (isLast || marketClosed);
    const proposedAction = proposePaperAction({
      recommendation: replayed.recommendation,
      approved: replayed.approved,
      position: portfolio.position,
      forceClose,
      quote,
      now: at,
    });

    const sizeUsd = replayed.approved ? replayed.positionSizeUsd : 0;
    const positionBefore = portfolio.position;
    const applied = applyPaperAction(portfolio, proposedAction, quote, at, sizeUsd, {
      book: depthBook,
      execution,
    });
    portfolio = applied.portfolio;

    if (applied.rejectionReason) {
      rejectedActions += 1;
    }
    if (applied.appliedAction === 'hold') {
      holds += 1;
    } else if (applied.appliedAction.startsWith('buy_')) {
      buys += 1;
      entryQuote = quote;
      entryConditions = tradeConditions(quote, point.context);
      swarmStateAtEntry = {
        recommendation: replayed.recommendation,
        confidence: replayed.confidence,
        approved: replayed.approved,
        signals: replayed.signals,
      };
    } else if (applied.appliedAction.startsWith('sell_')) {
      sells += 1;
      if (
        positionBefore &&
        entryQuote &&
        entryConditions &&
        swarmStateAtEntry &&
        applied.rejectionReason === null &&
        applied.fillPriceUsd !== null &&
        applied.filledContracts > 0
      ) {
        const soldFraction = applied.filledContracts / positionBefore.contracts;
        const soldSlice = {
          ...positionBefore,
          contracts: applied.filledContracts,
          sizeUsd: toCents(positionBefore.sizeUsd * soldFraction),
        };
        closedTrades.push(
          buildClosedPaperTrade({
            marketId,
            position: soldSlice,
            entryQuote,
            exitQuote: quote,
            exitPriceUsd: applied.fillPriceUsd,
            exitAt: at,
            netPnlUsd: applied.stepRealisedPnlUsd,
            entryConditions,
            exitConditions: tradeConditions(quote, point.context),
            swarmStateAtEntry,
            resolvedTo,
            exitReason: closedExitReason(
              forceClose,
              positionBefore,
              markPriceForSide(positionBefore.side, quote),
              unrealisedPnlUsd(positionBefore, quote),
              at,
            ),
          }),
        );
        if (!applied.residualPosition) {
          entryQuote = null;
          entryConditions = null;
          swarmStateAtEntry = null;
        }
      }
    }

    if (portfolio.position) {
      const marked = markPosition(portfolio.position, quote);
      portfolio = { ...portfolio, position: marked.position };
      unrealised = marked.unrealisedPnlUsd;
    } else {
      unrealised = null;
    }

    const proposedFill = paperFillPrice(proposedAction, quote);
    const isBuy = proposedAction === 'buy_yes' || proposedAction === 'buy_no';
    const isSell = proposedAction === 'sell_yes' || proposedAction === 'sell_no';
    const exitAt =
      applied.appliedAction.startsWith('sell_') && applied.rejectionReason === null
        ? at.toISOString()
        : null;

    const position = portfolio.position;
    decisions.push({
      marketId,
      timestamp: point.context.at,
      yesPriceUsd: point.snapshot.buyYesPriceUsd,
      noPriceUsd: point.snapshot.buyNoPriceUsd,
      sellYesPriceUsd: point.snapshot.sellYesPriceUsd,
      sellNoPriceUsd: point.snapshot.sellNoPriceUsd,
      features: point.context.features,
      contextSummary: summariseContext(point.context),
      depthBook,
      ...(includeFullContext ? { context: point.context } : {}),
      signals: replayed.signals,
      swarmRecommendation: replayed.recommendation,
      approved: replayed.approved,
      confidence: replayed.confidence,
      proposedAction,
      appliedAction: applied.appliedAction,
      rejectionReason: applied.rejectionReason,
      proposedSide: sideFromAction(proposedAction),
      proposedEntryPriceUsd: isBuy
        ? (applied.fillPriceUsd ?? proposedFill)
        : (position?.entryPriceUsd ?? null),
      proposedExitPriceUsd: isSell ? (applied.fillPriceUsd ?? proposedFill) : null,
      filledSizeUsd: applied.filledSizeUsd,
      rejectedSizeUsd: applied.rejectedSizeUsd,
      position: position ? { ...position } : null,
      entryAt: position?.entryAt ?? null,
      exitAt,
      realisedPnlUsd:
        applied.stepRealisedPnlUsd !== 0 ? applied.stepRealisedPnlUsd : null,
      unrealisedPnlUsd: unrealised,
      cumulativeRealisedPnlUsd: portfolio.realisedPnlUsd,
      mfeUsd: position?.mfeUsd ?? null,
      maeUsd: position?.maeUsd ?? null,
      holdingMinutes: position ? holdingMinutes(position.entryAt, at) : null,
      resolvedTo,
    });
  }

  const finishedAt = new Date().toISOString();
  const first = decisions[0];
  const last = decisions[decisions.length - 1];

  return {
    marketId,
    title,
    startedAt,
    finishedAt,
    firstTimestamp: first?.timestamp ?? '',
    lastTimestamp: last?.timestamp ?? '',
    resolvedTo,
    options,
    decisions,
    closedTrades,
    summary: {
      decisions: decisions.length,
      buys,
      sells,
      holds,
      rejectedActions,
      totalRealisedPnlUsd: portfolio.realisedPnlUsd,
      finalUnrealisedPnlUsd: last?.unrealisedPnlUsd ?? null,
      openPosition: portfolio.position ? { ...portfolio.position } : null,
    },
  };
}

/** Paper-replay one market by id. */
export async function paperReplaySingleMarket(
  marketId: string,
  overrides?: Partial<PaperReplayOptions>,
  includeFullContext = true,
): Promise<PaperMarketHistory | null> {
  await connectMongo();
  const options = resolvePaperOptions(overrides);
  const snaps = await loadMarketSnapshots(marketId, 1);
  const title = snaps[0]?.title ?? marketId;
  return paperReplayMarket(marketId, title, options, includeFullContext);
}

/** Batch paper replay across the liveliest tradable markets. */
export async function runPaperReplay(
  overrides?: Partial<PaperReplayOptions>,
): Promise<PaperReplaySummary> {
  await connectMongo();
  const options = resolvePaperOptions(overrides);
  const startedAt = new Date();

  const candidates = await listTradableMarkets({
    limit: options.maxMarkets,
    minSnapshots: options.minSnapshots,
    // When fitness asks for books, pick filmed markets — not the newest quotes.
    requireOrderbook: options.requireOrderbook,
  });

  const skipped: PaperReplaySummary['skipped'] = [];
  const histories: PaperMarketHistory[] = [];

  for (const market of candidates) {
    const history = await paperReplayMarket(
      market.marketId,
      market.title,
      options,
      false,
    );
    if (!history || history.decisions.length === 0) {
      skipped.push({
        marketId: market.marketId,
        reason: 'Not enough decision points after thinning / filters.',
      });
      continue;
    }
    histories.push(history);
  }

  const finishedAt = new Date();

  const marketRows = histories.map((history) => ({
    marketId: history.marketId,
    title: history.title,
    decisions: history.summary.decisions,
    totalRealisedPnlUsd: history.summary.totalRealisedPnlUsd,
    finalUnrealisedPnlUsd: history.summary.finalUnrealisedPnlUsd,
    resolvedTo: history.resolvedTo,
  }));

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    options,
    marketsConsidered: candidates.length,
    marketsReplayed: histories.length,
    skipped,
    markets: await enrichMarketLabelFields(marketRows),
    histories,
  };
}
