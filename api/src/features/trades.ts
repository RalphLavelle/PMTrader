import type { TradeDoc } from '../collector/types.js';
import type { TradeFlowFeatures } from './types.js';

/**
 * Parse a Jupiter amount/price string that may be micro-USD (1_000_000 = $1)
 * or already a decimal dollar string.
 */
export function parseUsdAmount(raw: string | number | undefined): number {
  if (raw === undefined || raw === null) {
    return 0;
  }
  const value = typeof raw === 'number' ? raw : Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    return 0;
  }
  // Values well above 1 are almost certainly native micro-USD units.
  return value > 1_000 ? value / 1_000_000 : value;
}

/**
 * Trade-flow features for fills that fall inside `[endMs - windowMs, endMs]`.
 */
export function deriveTradeFlowFeatures(
  trades: TradeDoc[],
  endMs: number,
  windowMs: number,
): TradeFlowFeatures {
  const startMs = endMs - windowMs;
  const window = trades.filter((t) => {
    const tMs = t.timestamp.getTime();
    return tMs >= startMs && tMs <= endMs;
  });

  let buyNotionalUsd = 0;
  let sellNotionalUsd = 0;
  let vwapNumerator = 0;
  let vwapDenominator = 0;

  for (const trade of window) {
    const amount = parseUsdAmount(trade.amountUsd);
    const price = parseUsdAmount(trade.priceUsd);
    if (trade.action === 'buy') {
      buyNotionalUsd += amount;
    } else {
      sellNotionalUsd += amount;
    }
    vwapNumerator += price * amount;
    vwapDenominator += amount;
  }

  const total = buyNotionalUsd + sellNotionalUsd;
  const tradeCount = window.length;

  return {
    tradeCount,
    buyNotionalUsd,
    sellNotionalUsd,
    buySellImbalance: total > 0 ? (buyNotionalUsd - sellNotionalUsd) / total : 0,
    averageTradeSizeUsd: tradeCount > 0 ? total / tradeCount : 0,
    vwap: vwapDenominator > 0 ? vwapNumerator / vwapDenominator : null,
  };
}
