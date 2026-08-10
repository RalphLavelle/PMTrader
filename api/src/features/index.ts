/** Phase 2 Feature Builder — public surface. */
export {
  orderbooksAtOrBefore,
  snapshotsAtOrBefore,
  tradesAtOrBefore,
} from './as-of.js';
export { asOfOrderbook, buildFeatureRows } from './builder.js';
export {
  buildMarketContextAt,
  snapshotToHistoryDoc,
  type BuildMarketContextInput,
  type MarketContext,
} from './context.js';
export {
  loadMarketDisplayMeta,
  lookupMarketDisplayMeta,
  type MarketDisplayMeta,
} from './market-display.js';
export {
  countLabels,
  listLabelledMarkets,
  listMarketCoverage,
  listOrderbookCoverage,
  listTradableMarkets,
  loadCollectionCoverage,
  loadLabel,
  loadMarketOrderbooks,
  loadMarketSnapshots,
  loadTrades,
} from './coverage.js';
export {
  bestBid,
  deriveOrderbookFeatures,
  toDepthLadder,
  totalQuantity,
} from './orderbook.js';
export {
  asOfSnapshot,
  derivePriceFeatures,
  hoursToClose,
  impliedYesProbability,
} from './price.js';
export { reconstructSnapshot } from './reconstruct.js';
export { deriveTradeFlowFeatures, parseUsdAmount } from './trades.js';
export type {
  CollectionCoverage,
  DatasetOverview,
  DepthLevel,
  FeatureRow,
  LabelledMarketCoverage,
  MarketCoverage,
  OrderbookCoverage,
  OrderbookFeatures,
  PriceFeatures,
  TimeSeriesPoint,
  TradeFlowFeatures,
  TradableMarketCoverage,
} from './types.js';
