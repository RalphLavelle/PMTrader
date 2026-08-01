import type { AnalysisRecord, TradeOutcome } from '../schemas/index.js';

/** Filters accepted when querying stored analyses. */
export interface AnalysisQuery {
  /** Restrict results to a single market. */
  marketId?: string;
  /** Maximum number of records to return, newest first. Defaults to 20. */
  limit?: number;
}

/**
 * Persistence contract for completed swarm analyses.
 *
 * This is deliberately a narrow interface rather than a class. Every concrete
 * store (in-memory, JSON file, and later SQLite, PostgreSQL, or a vector
 * database) implements the same five methods, so swapping the backing store
 * never requires touching agent or swarm code.
 *
 * All methods are async even where the current implementations are synchronous,
 * because real databases are async and changing a signature later would ripple
 * through every caller.
 */
export interface AnalysisMemoryStore {
  /** Human-readable driver name, surfaced in health checks and logs. */
  readonly driver: string;

  /** Persist a completed analysis. Implementations must not mutate the input. */
  save(record: AnalysisRecord): Promise<AnalysisRecord>;

  /** Fetch one analysis by id, or null when it does not exist. */
  findById(id: string): Promise<AnalysisRecord | null>;

  /** List analyses newest-first, optionally filtered by market. */
  list(query?: AnalysisQuery): Promise<AnalysisRecord[]>;

  /**
   * Attach a resolution outcome to an existing analysis.
   *
   * Returns the updated record, or null when the id is unknown. This is the
   * hook a future Learning Agent uses to score past predictions.
   */
  recordOutcome(id: string, outcome: TradeOutcome): Promise<AnalysisRecord | null>;

  /** Remove every stored analysis. Primarily used by tests. */
  clear(): Promise<void>;
}

/**
 * Sort newest-first and apply the limit.
 *
 * Shared by concrete stores so query semantics stay identical across drivers.
 */
export function applyQuery(
  records: AnalysisRecord[],
  query: AnalysisQuery = {},
): AnalysisRecord[] {
  const { marketId, limit = 20 } = query;

  const filtered = marketId
    ? records.filter((record) => record.marketId === marketId)
    : records;

  return [...filtered]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, Math.max(0, limit));
}
