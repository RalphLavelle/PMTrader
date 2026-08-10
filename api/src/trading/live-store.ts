import { randomUUID } from 'node:crypto';
import type { Collection } from 'mongodb';
import type { AdaptiveWeightTable } from '../adaptive/types.js';
import { config } from '../config.js';
import type { CompletedFitnessTrade } from '../fitness/types.js';
import { connectMongo, getDatabase } from '../memory/mongodb.client.js';
import { emptyPortfolio } from './paper.js';
import type {
  LiveAdaptiveSnapshotDoc,
  LiveClosedTradeDoc,
  LivePaperDecisionDoc,
  LivePaperMarketState,
} from './live-types.js';

/**
 * Mongo persistence for continuous paper trading.
 *
 * Positions and adaptive snapshots survive application restarts.
 */

export async function initLivePaperStore(): Promise<void> {
  await connectMongo();

  await getLivePaperMarkets().createIndex({ marketId: 1 }, { unique: true });
  await getLivePaperMarkets().createIndex({ updatedAt: -1 });

  await getLivePaperDecisions().createIndex({ id: 1 }, { unique: true });
  await getLivePaperDecisions().createIndex({ marketId: 1, timestamp: -1 });
  await getLivePaperDecisions().createIndex({ timestamp: -1 });

  await getLiveClosedTrades().createIndex({ id: 1 }, { unique: true });
  await getLiveClosedTrades().createIndex({ marketId: 1, exitAt: -1 });
  await getLiveClosedTrades().createIndex({ owner: 1, exitAt: -1 });
  await getLiveClosedTrades().createIndex({ exitAt: -1 });
}

function getLivePaperMarkets(): Collection<LivePaperMarketState> {
  return getDatabase().collection(config.mongodbPaperPortfoliosCollection);
}

function getLivePaperDecisions(): Collection<LivePaperDecisionDoc> {
  return getDatabase().collection(config.mongodbPaperDecisionsCollection);
}

function getLiveClosedTrades(): Collection<LiveClosedTradeDoc> {
  return getDatabase().collection(config.mongodbPaperClosedTradesCollection);
}

function getAdaptiveSnapshots(): Collection<LiveAdaptiveSnapshotDoc> {
  return getDatabase().collection(config.mongodbAdaptiveWeightsCollection);
}

/** Fresh state for a market we have never paper-traded before. */
export function createEmptyMarketState(
  marketId: string,
  title: string,
  marketStatus = 'open',
): LivePaperMarketState {
  const now = new Date().toISOString();
  return {
    marketId,
    title,
    portfolio: emptyPortfolio(),
    specialistPortfolios: {},
    entryMeta: null,
    specialistEntryMeta: {},
    lastObservationAt: null,
    lastContentHash: null,
    lastDecisionAt: null,
    unrealisedPnlUsd: null,
    marketStatus,
    updatedAt: now,
    createdAt: now,
  };
}

/** Load one market's paper book, or null when never seen. */
export async function loadMarketState(
  marketId: string,
): Promise<LivePaperMarketState | null> {
  return getLivePaperMarkets().findOne({ marketId });
}

/** Upsert the full market state document. */
export async function saveMarketState(state: LivePaperMarketState): Promise<void> {
  const next = { ...state, updatedAt: new Date().toISOString() };
  await getLivePaperMarkets().replaceOne({ marketId: state.marketId }, next, {
    upsert: true,
  });
}

/** Every market that currently has an open simulated position. */
export async function listOpenPositionMarketIds(): Promise<string[]> {
  const rows = await getLivePaperMarkets()
    .find({ 'portfolio.position': { $ne: null } })
    .project({ marketId: 1 })
    .toArray();
  return rows.map((row) => row.marketId);
}

/** All persisted market states (for status / portfolio views). */
export async function listMarketStates(limit = 200): Promise<LivePaperMarketState[]> {
  return getLivePaperMarkets()
    .find({})
    .sort({ updatedAt: -1 })
    .limit(Math.max(1, limit))
    .toArray();
}

/** Append one decision audit row. */
export async function insertDecision(
  doc: Omit<LivePaperDecisionDoc, 'id' | 'createdAt'>,
): Promise<LivePaperDecisionDoc> {
  const full: LivePaperDecisionDoc = {
    ...doc,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  await getLivePaperDecisions().insertOne(full);
  return full;
}

/** Append closed trade(s); skips duplicates by id when retried. */
export async function insertClosedTrades(
  docs: Array<Omit<LiveClosedTradeDoc, 'id' | 'createdAt' | 'source'>>,
): Promise<LiveClosedTradeDoc[]> {
  const createdAt = new Date().toISOString();
  const full = docs.map((doc) => ({
    ...doc,
    id: randomUUID(),
    source: 'live_paper' as const,
    createdAt,
  }));
  if (full.length === 0) {
    return [];
  }
  await getLiveClosedTrades().insertMany(full);
  return full;
}

/** Recent closed live trades for fitness / adaptive rebuild. */
export async function listClosedTrades(limit = 2_000): Promise<LiveClosedTradeDoc[]> {
  return getLiveClosedTrades()
    .find({})
    .sort({ exitAt: -1 })
    .limit(Math.max(1, limit))
    .toArray();
}

/** Persist adaptive table + trade evidence so restarts keep weights. */
export async function saveAdaptiveSnapshot(
  table: AdaptiveWeightTable,
  trades: CompletedFitnessTrade[],
): Promise<void> {
  const doc: LiveAdaptiveSnapshotDoc = {
    _id: 'current',
    table,
    trades,
    updatedAt: new Date().toISOString(),
  };
  await getAdaptiveSnapshots().replaceOne({ _id: 'current' }, doc, { upsert: true });
}

/** Load the last published adaptive snapshot, if any. */
export async function loadAdaptiveSnapshot(): Promise<LiveAdaptiveSnapshotDoc | null> {
  return getAdaptiveSnapshots().findOne({ _id: 'current' });
}

/** Portfolio totals across all live paper markets. */
export async function summarisePortfolio(): Promise<{
  markets: number;
  openPositions: number;
  realisedPnlUsd: number;
  unrealisedPnlUsd: number;
}> {
  const states = await listMarketStates(5_000);
  let openPositions = 0;
  let realisedPnlUsd = 0;
  let unrealisedPnlUsd = 0;
  for (const state of states) {
    realisedPnlUsd += state.portfolio.realisedPnlUsd;
    if (state.portfolio.position) {
      openPositions += 1;
    }
    if (typeof state.unrealisedPnlUsd === 'number') {
      unrealisedPnlUsd += state.unrealisedPnlUsd;
    }
  }
  return {
    markets: states.length,
    openPositions,
    realisedPnlUsd: Math.round(realisedPnlUsd * 100) / 100,
    unrealisedPnlUsd: Math.round(unrealisedPnlUsd * 100) / 100,
  };
}
