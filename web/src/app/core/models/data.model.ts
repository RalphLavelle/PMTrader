/** Types for the /data dashboards — mirror the API /api/data responses. */

export interface CollectionCoverage {
  collection: string;
  count: number;
  distinctMarkets: number;
  oldestAt: string | null;
  newestAt: string | null;
}

export interface DatasetOverview {
  collections: CollectionCoverage[];
  totalDistinctMarkets: number;
  labelledMarkets: number;
  collectorEnabled: boolean;
  /** Default categories from `.env` when the schedule does not override. */
  collectorCategories?: string[];
  schedulePath: string;
  schedule: {
    enabled: boolean;
    marketIds: string[];
    streams: Record<
      string,
      {
        enabled: boolean;
        every: { value: number; unit: string };
        lastFetchAt: string | null;
        lastError: string | null;
      }
    >;
  };
}

export interface MarketCoverage {
  marketId: string;
  title: string;
  eventTitle?: string;
  status: string;
  snapshotCount: number;
  latestBuyYesPriceUsd: number;
  latestImpliedYes: number;
  lastSeenAt: string;
  category?: string;
}

export interface PriceSeriesPoint {
  at: string;
  buyYesPriceUsd: number;
  buyNoPriceUsd: number;
  sellYesPriceUsd?: number;
  sellNoPriceUsd?: number;
  impliedYes: number;
  volumeUsd: number;
  status?: string;
  openTime?: number | null;
  closeTime?: number | null;
}

export interface OrderbookFeatures {
  bestYesBid: number | null;
  bestNoBid: number | null;
  impliedYesAsk: number | null;
  mid: number | null;
  spread: number | null;
  yesDepthQty: number;
  noDepthQty: number;
  totalDepth: number;
  yesLevels: number;
  noLevels: number;
  depthImbalance: number;
}

export interface PriceFeatures {
  impliedYesProbability: number;
  change1m: number | null;
  change5m: number | null;
  change10m: number | null;
  volatility: number | null;
  volumeDelta: number | null;
  hoursToClose: number | null;
}

export interface TradeFlowFeatures {
  tradeCount: number;
  buyNotionalUsd: number;
  sellNotionalUsd: number;
  buySellImbalance: number;
  averageTradeSizeUsd: number;
  vwap: number | null;
}

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
  openTime: number | null;
  closeTime: number | null;
  price: PriceFeatures;
  orderbook: OrderbookFeatures | null;
  trades: TradeFlowFeatures;
  result: 'yes' | 'no' | null;
}

export interface MarketDetailData {
  marketId: string;
  title: string;
  eventTitle?: string;
  category?: string;
  status: string;
  openTime?: number | null;
  closeTime?: number | null;
  snapshotCount: number;
  orderbookCount: number;
  tradeCount: number;
  label: {
    result: 'yes' | 'no' | null;
    status: string;
    labelledAt: string;
  } | null;
  series: PriceSeriesPoint[];
  features: FeatureRow[];
}

export interface OrderbookCoverage {
  marketId: string;
  title: string;
  eventTitle?: string;
  category?: string;
  snapshotCount: number;
  lastSeenAt: string;
}

export interface DepthLevel {
  priceUsd: number;
  quantity: number;
}

export interface OrderbookDetailData {
  marketId: string;
  title: string;
  eventTitle?: string;
  category?: string;
  snapshotCount: number;
  latest: {
    capturedAt: string;
    features: OrderbookFeatures;
    yesLadder: DepthLevel[];
    noLadder: DepthLevel[];
  };
  series: Array<{
    at: string;
    spread: number | null;
    mid: number | null;
    depthImbalance: number;
    totalDepth: number;
  }>;
}

export interface CollectedTrade {
  id: string;
  timestamp: string;
  marketId: string;
  ownerPubkey: string;
  action: 'buy' | 'sell';
  side: 'yes' | 'no';
  amountUsd: string;
  priceUsd: string;
  eventTitle?: string;
  marketTitle?: string;
  category?: string;
}

export interface TradesDataResponse {
  data: CollectedTrade[];
  summary: {
    tradeCount: number;
    buyNotionalUsd: number;
    sellNotionalUsd: number;
    buySellImbalance: number;
  };
}

export interface FeaturesDataResponse {
  marketId: string;
  title: string;
  rowCount: number;
  features: FeatureRow[];
}

/** One point for the shared SVG line chart. */
export interface ChartPoint {
  at: string;
  value: number;
}
