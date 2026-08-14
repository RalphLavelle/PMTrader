/**
 * Intramarket trading evaluation — public surface.
 *
 * Grades hypothetical entry/exit trades while a market is still open.
 * Resolution labels remain available as secondary context elsewhere.
 *
 * Also hosts the continuous live paper-trading loop (PAPER ONLY).
 */
export {
  buildTradeEpisode,
  estimateIntramarketPnlUsd,
  findExitSnapshot,
  sidePrice,
  wasTradeProfitable,
} from './pnl.js';
export {
  applyPaperAction,
  emptyPortfolio,
  fullQuoteFrom,
  holdingMinutes,
  isValidFillPrice,
  markPosition,
  markPriceForSide,
  paperFillPrice,
  proposePaperAction,
  unrealisedPnlUsd,
} from './paper.js';
export {
  resolveExecutionOptions,
  simulateBuyFill,
  simulateSellFill,
} from './fill-model.js';
export { buildClosedPaperTrade } from './closed-trade.js';
export {
  DEFAULT_EXECUTION_OPTIONS,
  type DepthBook,
  type ExcessLiquidityMode,
  type ExecutionOptions,
  type FillPricing,
  type SimulatedFill,
} from './execution-types.js';
export type {
  FullQuote,
  PaperAction,
  PaperApplyOptions,
  PaperApplyResult,
  PaperExitReason,
  PaperPortfolio,
  PaperPosition,
  PaperSide,
  StopKind,
} from './paper-types.js';
export {
  bakeStopRecipe,
  chooseStopKind,
  closedExitReason,
  configuredStopLimits,
  DEFAULT_STOP_LIMITS,
  exitHitReason,
  ratchetTrailingStop,
} from './exit-gate.js';
export { fixedHoldPolicy, type ExitPolicy, type QuotePrices, type TradeEpisode } from './types.js';
export {
  getLastLivePaperPass,
  isLivePaperPassRunning,
  persistAdaptiveSnapshot,
  runLivePaperPassOnce,
  startLivePaperTrading,
  stopLivePaperTrading,
} from './live-runner.js';
export { runLivePaperPass, processLivePaperMarket, resolvePaperUniverse } from './live-engine.js';
export type {
  LivePaperMarketState,
  LivePaperPassResult,
  LiveClosedTradeDoc,
  PaperIntent,
} from './live-types.js';
