/**
 * Pure helpers for the fitness trading dashboard.
 *
 * Equity / drawdown / market rollups are derived from coherent closed trades
 * so the UI never invents a second scoreboard.
 */
import { ChartPoint } from '../../core/models/data.model';
import { CompletedFitnessTrade } from '../../core/models/fitness.model';

/** Sort oldest → newest by exit time (equity curve order). */
export function sortTradesChronologically(
  trades: CompletedFitnessTrade[],
): CompletedFitnessTrade[] {
  return [...trades].sort((a, b) => Date.parse(a.exitAt) - Date.parse(b.exitAt));
}

/** Cumulative net P&L after each closed trade. */
export function equityCurvePoints(trades: CompletedFitnessTrade[]): ChartPoint[] {
  let equity = 0;
  return sortTradesChronologically(trades).map((trade) => {
    equity = Math.round((equity + trade.netPnlUsd) * 100) / 100;
    return { at: trade.exitAt, value: equity };
  });
}

/** Drawdown from running peak after each closed trade (≤ 0). */
export function drawdownCurvePoints(trades: CompletedFitnessTrade[]): ChartPoint[] {
  let equity = 0;
  let peak = 0;
  return sortTradesChronologically(trades).map((trade) => {
    equity = Math.round((equity + trade.netPnlUsd) * 100) / 100;
    peak = Math.max(peak, equity);
    const drawdown = Math.round((equity - peak) * 100) / 100;
    return { at: trade.exitAt, value: drawdown };
  });
}

export interface MarketTradingRow {
  marketId: string;
  trades: number;
  wins: number;
  winRate: number | null;
  grossPnlUsd: number;
  netPnlUsd: number;
  resolvedTo: 'yes' | 'no' | null;
}

/** Roll coherent trades up by market for the "individual markets" view. */
export function marketTradingRows(trades: CompletedFitnessTrade[]): MarketTradingRow[] {
  const byMarket = new Map<string, CompletedFitnessTrade[]>();
  for (const trade of trades) {
    const list = byMarket.get(trade.marketId) ?? [];
    list.push(trade);
    byMarket.set(trade.marketId, list);
  }

  return [...byMarket.entries()]
    .map(([marketId, list]) => {
      let net = 0;
      let gross = 0;
      let wins = 0;
      let decided = 0;
      let resolvedTo: 'yes' | 'no' | null = null;
      for (const trade of list) {
        net += trade.netPnlUsd;
        gross += trade.grossPnlUsd;
        if (trade.netPnlUsd > 0) {
          wins += 1;
          decided += 1;
        } else if (trade.netPnlUsd < 0) {
          decided += 1;
        }
        if (trade.resolvedTo) {
          resolvedTo = trade.resolvedTo;
        }
      }
      return {
        marketId,
        trades: list.length,
        wins,
        winRate: decided > 0 ? wins / decided : null,
        grossPnlUsd: Math.round(gross * 100) / 100,
        netPnlUsd: Math.round(net * 100) / 100,
        resolvedTo,
      };
    })
    .sort((a, b) => b.netPnlUsd - a.netPnlUsd);
}
