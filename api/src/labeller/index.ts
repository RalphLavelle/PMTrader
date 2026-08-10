/** Phase 3 outcome labeller — public entry points. */
export { countResolvedMarkets, findLabelCandidates } from './candidates.js';
export { isDecisive, isSettled, labelMarketFromJupiter } from './market-labels.js';
export { applyLabelsToRuns } from './run-outcomes.js';
export {
  getLastLabellerPass,
  isLabellerPassRunning,
  runLabellerPass,
  startLabeller,
  stopLabeller,
} from './runner.js';
export {
  buildIntramarketTradeOutcome,
  buildTradeOutcome,
  deriveWasCorrect,
  estimateRealizedPnlUsd,
  estimateResolutionPnlUsd,
} from './scoring.js';
export type {
  LabelAttempt,
  LabelCandidate,
  LabelCandidateReason,
  LabellerPassResult,
  RunLabellingResult,
} from './types.js';
