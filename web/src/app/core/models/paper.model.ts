/** Types for the live paper-trading dashboard — mirror /api/paper responses. */

import { AdaptiveWeightTable } from './fitness.model';

export interface PaperPortfolioSummary {
  markets: number;
  openPositions: number;
  realisedPnlUsd: number;
  unrealisedPnlUsd: number;
}

export interface PaperOpenPosition {
  marketId: string;
  title: string;
  side: 'yes' | 'no' | null;
  sizeUsd: number | null;
  entryAt: string | null;
  entryPriceUsd: number | null;
  unrealisedPnlUsd: number | null;
  realisedPnlUsd: number;
  marketStatus: string;
  updatedAt: string;
}

export interface PaperPassResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  marketsConsidered: number;
  marketsProcessed: number;
  skippedStale: number;
  skippedDuplicate: number;
  entries: number;
  exits: number;
  rejects: number;
  riskVetoes: number;
  closedTrades: number;
  errors: string[];
}

export interface PaperStatus {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  decisionIntervalMinutes: number;
  staleMs: number;
  maxMarkets: number;
  paperOnly: true;
  portfolio: PaperPortfolioSummary;
  openPositions: PaperOpenPosition[];
  adaptive: AdaptiveWeightTable | null;
  lastPass: PaperPassResult | null;
}

/** One closed live paper trade from Mongo. */
export interface PaperClosedTrade {
  id: string;
  marketId: string;
  owner: string;
  side: 'yes' | 'no';
  quantity: number;
  sizeUsd: number;
  entryAt: string;
  entryPriceUsd: number;
  exitAt: string;
  exitPriceUsd: number;
  grossPnlUsd: number;
  estimatedCostUsd: number;
  netPnlUsd: number;
  holdingMinutes: number;
  mfeUsd: number;
  maeUsd: number;
  resolvedTo: 'yes' | 'no' | null;
  adaptiveWeightsAtEntry: Record<string, number> | null;
  source: 'live_paper';
  createdAt: string;
}

export interface PaperTradesResponse {
  paperOnly: true;
  count: number;
  trades: PaperClosedTrade[];
}

export interface PaperRunResponse {
  paperOnly: true;
  result: PaperPassResult;
}
