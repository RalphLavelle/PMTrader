import { analysisRecordSchema, swarmAnalysisResultSchema, type SwarmAnalysisResult, type TradeOutcome } from '../schemas/index.js';
import { getRunsCollection } from './mongodb.client.js';
import type { AnalysisMemoryStore, AnalysisQuery } from './types.js';

/**
 * Normalise a MongoDB document into a full run result.
 *
 * Older saves stored only the flat analysis record. Those are upgraded on read
 * so `/api/runs` always returns the same shape as a live analysis response.
 */
function normalizeStoredRun(document: Record<string, unknown>): SwarmAnalysisResult | null {
  const fullRun = swarmAnalysisResultSchema.safeParse(document);
  if (fullRun.success) {
    return fullRun.data;
  }

  const legacyRecord = analysisRecordSchema.safeParse(document);
  if (!legacyRecord.success) {
    console.warn('[memory] Skipping malformed run document in MongoDB.');
    return null;
  }

  const record = legacyRecord.data;
  const implied =
    typeof record.signals[0]?.supportingMetrics?.impliedYesProbability === 'number'
      ? record.signals[0].supportingMetrics.impliedYesProbability
      : 0.5;

  return {
    record,
    snapshot: {
      marketId: record.marketId,
      title: record.marketId,
      status: 'unknown',
      buyYesPriceUsd: 0,
      buyNoPriceUsd: 0,
      sellYesPriceUsd: 0,
      sellNoPriceUsd: 0,
      volumeUsd: 0,
      yesDepth: { levels: 0, totalQuantity: 0, bestPriceUsd: 0 },
      noDepth: { levels: 0, totalQuantity: 0, bestPriceUsd: 0 },
      rulesPrimary: null,
      rulesSecondary: null,
      closeTime: null,
      capturedAt: record.timestamp,
    },
    features: {
      impliedYesProbability: implied,
      spreadUsd: 0,
      depthImbalance: 0,
      totalDepth: 0,
      liquidityScore: 0,
      priceExtremity: 0,
      hoursToClose: null,
    },
  };
}

/**
 * Persist completed swarm runs in MongoDB.
 *
 * Each run is stored as one document in the `runs` collection using the same
 * shape returned by `POST /api/swarm/analysis/:marketId`.
 */
export class MongoAnalysisStore implements AnalysisMemoryStore {
  readonly driver = 'mongodb';

  async save(run: SwarmAnalysisResult): Promise<SwarmAnalysisResult> {
    const stored: SwarmAnalysisResult = {
      record: { ...run.record },
      snapshot: { ...run.snapshot },
      features: { ...run.features },
    };

    await getRunsCollection().replaceOne({ 'record.id': stored.record.id }, stored, { upsert: true });

    return stored;
  }

  async findById(id: string): Promise<SwarmAnalysisResult | null> {
    const document = await getRunsCollection().findOne({
      $or: [{ 'record.id': id }, { id }],
    });

    return document ? normalizeStoredRun(document as Record<string, unknown>) : null;
  }

  async list(query: AnalysisQuery = {}): Promise<SwarmAnalysisResult[]> {
    const { marketId, limit = 20 } = query;
    const filter = marketId
      ? { $or: [{ 'record.marketId': marketId }, { marketId }] }
      : {};

    const documents = await getRunsCollection()
      .find(filter)
      .sort({ 'record.timestamp': -1, timestamp: -1 })
      .limit(Math.max(0, limit))
      .toArray();

    return documents
      .map((document) => normalizeStoredRun(document as Record<string, unknown>))
      .filter((run): run is SwarmAnalysisResult => run !== null);
  }

  async listPendingOutcomes(limit = 50): Promise<SwarmAnalysisResult[]> {
    // Both shapes must be unscored. Legacy documents kept the record's fields at
    // the top level, so `record.outcome` is missing on them while `outcome` is
    // the real field — and vice versa for current documents. In MongoDB a
    // `null` match also matches a missing field, which is what makes the second
    // clause work for both. Checking only one shape would return every current
    // document, scored or not, and the limit would then hide the real backlog.
    const documents = await getRunsCollection()
      .find({
        $and: [
          { $or: [{ 'record.outcome': null }, { 'record.outcome': { $exists: false } }] },
          { outcome: null },
        ],
      })
      .sort({ 'record.timestamp': 1, timestamp: 1 })
      .limit(Math.min(Math.max(limit, 1), 500))
      .toArray();

    return documents
      .map((document) => normalizeStoredRun(document as Record<string, unknown>))
      .filter((run): run is SwarmAnalysisResult => run !== null)
      .filter((run) => run.record.outcome === null);
  }

  async recordOutcome(id: string, outcome: TradeOutcome): Promise<SwarmAnalysisResult | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }

    const updated: SwarmAnalysisResult = {
      ...existing,
      record: { ...existing.record, outcome },
    };

    await getRunsCollection().replaceOne({ 'record.id': id }, updated);

    return updated;
  }

  async clear(): Promise<void> {
    await getRunsCollection().deleteMany({});
  }
}
