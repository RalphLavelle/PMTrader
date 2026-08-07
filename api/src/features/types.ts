/**
 * Phase 2 Feature Builder types — computed on read from collector MongoDB rows.
 * Nothing here is persisted; redefine freely without re-collecting.
 */

/** Binary-market microstructure derived from a stored orderbook. */
export interface OrderbookFeatures {
  bestYesBid: number | null;
  bestNoBid: number | null;
  /** Implied YES ask = 1 − best NO bid. */
  impliedYesAsk: number | null;
  mid: number | null;
  /** Binary spread = 1 − bestNoBid − bestYesBid. */
  spread: number | null;
  yesDepthQty: number;
  noDepthQty: number;
  totalDepth: number;
  yesLevels: number;
  noLevels: number;
  depthImbalance: number;
}

/** Price / momentum features derived from a snapshot series. */
export interface PriceFeatures {
  impliedYesProbability: number;
  change1m: number | null;
  change5m: number | null;
  change10m: number | null;
  /** Std-dev of consecutive implied-prob returns in the lookback window. */
  volatility: number | null;
  /** Change in cumulative volumeUsd since the previous snapshot. */
  volumeDelta: number | null;
  hoursToClose: number | null;
}

/** Trade-flow features over a lookback window ending at a snapshot. */
export interface TradeFlowFeatures {
  tradeCount: number;
  buyNotionalUsd: number;
  sellNotionalUsd: number;
  /** Positive when buys dominate, negative when sells do (−1..1). */
  buySellImbalance: number;
  averageTradeSizeUsd: number;
  vwap: number | null;
}

/** One fully joined feature row at a snapshot timestamp. */
export interface FeatureRow {
  marketId: string;
  title: string;
  status: string;
  capturedAt: string;
  buyYesPriceUsd: number;
  buyNoPriceUsd: number;
  sellYesPriceUsd: number;
  sellNoPriceUsd: number;
  volumeUsd: number;
  closeTime: number | null;
  price: PriceFeatures;
  orderbook: OrderbookFeatures | null;
  trades: TradeFlowFeatures;
  /** Outcome label when the market has resolved, else null. */
  result: 'yes' | 'no' | null;
}

/** Coverage stats for one MongoDB collection. */
export interface CollectionCoverage {
  collection: string;
  count: number;
  distinctMarkets: number;
  oldestAt: string | null;
  newestAt: string | null;
}

/** One market's presence in the snapshot store. */
export interface MarketCoverage {
  marketId: string;
  title: string;
  status: string;
  snapshotCount: number;
  latestBuyYesPriceUsd: number;
  latestImpliedYes: number;
  lastSeenAt: string;
  category?: string;
}

/**
 * One market with a decisive outcome, plus how much history backs it.
 * Produced by the Phase 3 labeller; consumed by GET /api/data/labelled.
 */
export interface LabelledMarketCoverage {
  marketId: string;
  title: string;
  /** The side that won. Only decisive markets appear here. */
  result: 'yes' | 'no';
  status: string;
  closeTime: number | null;
  labelledAt: string;
  snapshotCount: number;
  orderbookCount: number;
}

/** Dataset overview returned by GET /api/data/overview. */
export interface DatasetOverview {
  collections: CollectionCoverage[];
  totalDistinctMarkets: number;
  /** Markets with any label, including those closed without a result. */
  labelledMarkets: number;
  /** Markets with a decisive yes/no result — the supervised subset. */
  resolvedMarkets: number;
  collectorEnabled: boolean;
  labellerEnabled: boolean;
  schedulePath: string;
  schedule: unknown;
}

/** One point on a simple time series (charts / tables). */
export interface TimeSeriesPoint {
  at: string;
  value: number;
}

/** Orderbook ladder level for the UI. */
export interface DepthLevel {
  priceUsd: number;
  quantity: number;
}
