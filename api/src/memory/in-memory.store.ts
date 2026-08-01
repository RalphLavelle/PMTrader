import type { AnalysisRecord, TradeOutcome } from '../schemas/index.js';
import { applyQuery, type AnalysisMemoryStore, type AnalysisQuery } from './types.js';

/**
 * Process-local analysis store backed by a `Map`.
 *
 * This is the default driver: it has no setup cost and keeps development and
 * tests fast. Records are lost when the process restarts, which is acceptable
 * while the swarm is advisory rather than trading automatically.
 *
 * A bounded capacity prevents a long-running scheduler from growing the heap
 * without limit; the oldest record is evicted once the cap is reached.
 */
export class InMemoryAnalysisStore implements AnalysisMemoryStore {
  readonly driver = 'in-memory';

  private readonly records = new Map<string, AnalysisRecord>();

  constructor(private readonly capacity = 500) {}

  async save(record: AnalysisRecord): Promise<AnalysisRecord> {
    // Store a shallow clone so later mutation of the caller's object cannot
    // silently rewrite history that has already been "persisted".
    const stored: AnalysisRecord = { ...record };
    this.records.set(stored.id, stored);
    this.evictOldest();
    return stored;
  }

  async findById(id: string): Promise<AnalysisRecord | null> {
    return this.records.get(id) ?? null;
  }

  async list(query?: AnalysisQuery): Promise<AnalysisRecord[]> {
    return applyQuery([...this.records.values()], query);
  }

  async recordOutcome(id: string, outcome: TradeOutcome): Promise<AnalysisRecord | null> {
    const existing = this.records.get(id);
    if (!existing) {
      return null;
    }

    const updated: AnalysisRecord = { ...existing, outcome };
    this.records.set(id, updated);
    return updated;
  }

  async clear(): Promise<void> {
    this.records.clear();
  }

  /** Drop the oldest insertions until the map fits within `capacity`. */
  private evictOldest(): void {
    while (this.records.size > this.capacity) {
      // Map iteration order is insertion order, so the first key is the oldest.
      const oldestKey = this.records.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.records.delete(oldestKey);
    }
  }
}
