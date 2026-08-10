import type {
  CompletedFitnessTrade,
  RegimeDimension,
  TradeBehaviourStats,
  TradingPerformance,
} from './types.js';

/**
 * Primary fitness maths — roll coherent closed trades into performance stats.
 *
 * Pure functions only. One observation ≠ one trade: callers must pass completed
 * buy→sell cycles from the paper book.
 */

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Peak-to-trough drawdown on the equity curve of cumulative net P&L. */
export function maxDrawdownUsd(trades: CompletedFitnessTrade[]): number {
  let equity = 0;
  let peak = 0;
  let worst = 0;

  for (const trade of trades) {
    equity = toCents(equity + trade.netPnlUsd);
    peak = Math.max(peak, equity);
    worst = Math.min(worst, equity - peak);
  }

  return toCents(Math.abs(worst));
}

/** How many times equity made a fresh trough below the running peak. */
export function countDrawdownEvents(trades: CompletedFitnessTrade[]): number {
  let equity = 0;
  let peak = 0;
  let events = 0;
  let inDrawdown = false;

  for (const trade of trades) {
    equity = toCents(equity + trade.netPnlUsd);
    if (equity > peak) {
      peak = equity;
      inDrawdown = false;
      continue;
    }
    if (equity < peak && !inDrawdown) {
      events += 1;
      inDrawdown = true;
    }
  }

  return events;
}

/**
 * Empty performance block — used when an owner closed zero trades.
 */
export function emptyTradingPerformance(
  behaviour?: Partial<TradeBehaviourStats>,
): TradingPerformance {
  return {
    realisedPnlUsd: 0,
    grossPnlUsd: 0,
    returnOnCapital: null,
    trades: 0,
    winRate: null,
    avgTradePnlUsd: null,
    avgProfitPerTrade: null,
    avgLossPerTrade: null,
    profitFactor: null,
    largestWinnerUsd: null,
    largestLoserUsd: null,
    maxDrawdownUsd: 0,
    avgHoldingMinutes: null,
    avgMfeUsd: null,
    avgMaeUsd: null,
    riskAdjustedReturn: null,
    behaviour: {
      missedOpportunities: behaviour?.missedOpportunities ?? 0,
      prematureExits: behaviour?.prematureExits ?? 0,
      losingExits: behaviour?.losingExits ?? 0,
      heldTooLong: behaviour?.heldTooLong ?? 0,
      drawdownEvents: behaviour?.drawdownEvents ?? 0,
    },
  };
}

/**
 * Summarise a set of coherent closed trades into the primary scoreboard.
 */
export function summariseTrades(
  trades: CompletedFitnessTrade[],
  behaviour?: Partial<TradeBehaviourStats>,
): TradingPerformance {
  if (trades.length === 0) {
    return emptyTradingPerformance(behaviour);
  }

  let realised = 0;
  let gross = 0;
  let capital = 0;
  let wins = 0;
  let losses = 0;
  let profitSum = 0;
  let lossSum = 0;
  let holdSum = 0;
  let mfeSum = 0;
  let maeSum = 0;
  let largestWinner: number | null = null;
  let largestLoser: number | null = null;

  for (const trade of trades) {
    realised += trade.netPnlUsd;
    gross += trade.grossPnlUsd;
    capital += trade.sizeUsd;
    holdSum += trade.holdingMinutes;
    mfeSum += trade.mfeUsd;
    maeSum += trade.maeUsd;

    if (trade.netPnlUsd > 0) {
      wins += 1;
      profitSum += trade.netPnlUsd;
      largestWinner =
        largestWinner === null
          ? trade.netPnlUsd
          : Math.max(largestWinner, trade.netPnlUsd);
    } else if (trade.netPnlUsd < 0) {
      losses += 1;
      lossSum += trade.netPnlUsd;
      largestLoser =
        largestLoser === null
          ? trade.netPnlUsd
          : Math.min(largestLoser, trade.netPnlUsd);
    }
  }

  const drawdown = maxDrawdownUsd(trades);
  const drawdownEvents = countDrawdownEvents(trades);
  const decided = wins + losses;

  return {
    realisedPnlUsd: toCents(realised),
    grossPnlUsd: toCents(gross),
    returnOnCapital: capital > 0 ? round(realised / capital) : null,
    trades: trades.length,
    winRate: decided > 0 ? round(wins / decided) : null,
    avgTradePnlUsd: toCents(realised / trades.length),
    avgProfitPerTrade: wins > 0 ? toCents(profitSum / wins) : null,
    avgLossPerTrade: losses > 0 ? toCents(lossSum / losses) : null,
    profitFactor:
      lossSum < 0 ? round(profitSum / Math.abs(lossSum)) : wins > 0 ? null : null,
    largestWinnerUsd: largestWinner === null ? null : toCents(largestWinner),
    largestLoserUsd: largestLoser === null ? null : toCents(largestLoser),
    maxDrawdownUsd: drawdown,
    avgHoldingMinutes: round(holdSum / trades.length),
    avgMfeUsd: toCents(mfeSum / trades.length),
    avgMaeUsd: toCents(maeSum / trades.length),
    riskAdjustedReturn: drawdown > 0 ? round(realised / drawdown) : null,
    behaviour: {
      missedOpportunities: behaviour?.missedOpportunities ?? 0,
      prematureExits: behaviour?.prematureExits ?? 0,
      losingExits: behaviour?.losingExits ?? losses,
      heldTooLong: behaviour?.heldTooLong ?? 0,
      drawdownEvents: behaviour?.drawdownEvents ?? drawdownEvents,
    },
  };
}

/** Implied P(YES) from the two buy prices at entry. */
export function entryImpliedYes(trade: CompletedFitnessTrade): number {
  const total = trade.entryConditions.yesPriceUsd + trade.entryConditions.noPriceUsd;
  if (!Number.isFinite(total) || total <= 0) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, trade.entryConditions.yesPriceUsd / total));
}

/** Regime bucket helpers shared with forecasting regimes. */
export function tradeMatchesRegime(
  trade: CompletedFitnessTrade,
  dimension: RegimeDimension,
  bucket: string,
): boolean {
  const c = trade.entryConditions;
  const distance = Math.abs(entryImpliedYes(trade) - 0.5);

  if (dimension === 'liquidity') {
    if (bucket === 'thin') return c.liquidityScore < 0.33;
    if (bucket === 'moderate') return c.liquidityScore >= 0.33 && c.liquidityScore < 0.66;
    if (bucket === 'deep') return c.liquidityScore >= 0.66;
  }
  if (dimension === 'time_to_close') {
    if (bucket === 'hot') return c.hoursToClose !== null && c.hoursToClose <= 1;
    if (bucket === 'warm')
      return c.hoursToClose !== null && c.hoursToClose > 1 && c.hoursToClose <= 24;
    if (bucket === 'cold') return c.hoursToClose !== null && c.hoursToClose > 24;
    if (bucket === 'unknown') return c.hoursToClose === null;
  }
  if (dimension === 'market_conviction') {
    if (bucket === 'toss-up') return distance <= 0.1;
    if (bucket === 'leaning') return distance > 0.1 && distance <= 0.3;
    if (bucket === 'lopsided') return distance > 0.3;
  }
  if (dimension === 'orderbook') {
    if (bucket === 'with-depth') return c.hadOrderbook;
    if (bucket === 'no-depth') return !c.hadOrderbook;
  }
  return false;
}
