import type { SwarmAnalysisResult, TradeOutcome } from '../schemas/index.js';

/** Filters accepted when querying stored runs. */
export interface AnalysisQuery {
  /** Restrict results to a single market. */
  marketId?: string;
  /** Maximum number of records to return, newest first. Defaults to 20. */
  limit?: number;
}

/**
 * Persistence contract for completed swarm runs.
 *
 * Stores the full run payload (`record`, `snapshot`, and `features`) so runs
 * can be retrieved in the same shape as a live analysis response.
 */
export interface AnalysisMemoryStore {
  /** Human-readable driver name, surfaced in health checks and logs. */
  readonly driver: string;

  /** Persist a completed run. Implementations must not mutate the input. */
  save(run: SwarmAnalysisResult): Promise<SwarmAnalysisResult>;

  /** Fetch one run by record id, or null when it does not exist. */
  findById(id: string): Promise<SwarmAnalysisResult | null>;

  /** List runs newest-first, optionally filtered by market. */
  list(query?: AnalysisQuery): Promise<SwarmAnalysisResult[]>;

  /**
   * Attach a resolution outcome to an existing run.
   *
   * Returns the updated run, or null when the id is unknown.
   */
  recordOutcome(id: string, outcome: TradeOutcome): Promise<SwarmAnalysisResult | null>;

  /** Remove every stored run. Primarily used by tests. */
  clear(): Promise<void>;
}
