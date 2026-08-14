/**
 * Types for the Phase 1 research-dataset collector.
 *
 * Documents match docs/ResearchDataset.md. Features are NOT stored here —
 * they are computed later on read so definitions can change without re-collecting.
 *
 * Stream names in schedule.json match the MongoDB collections they write to.
 */

/** How often a stream should run — edit value/unit in schedule.json. */
export interface ScheduleInterval {
  value: number;
  unit: 'seconds' | 'minutes';
}

/** Extra knobs that only apply to the market_snapshots (price) stream. */
export interface MarketSnapshotsOptions {
  /** How many /events pages to fetch per sweep (default 2). */
  maxPages: number;
  /** Events per page (default 50). */
  pageSize: number;
  /**
   * When true, skip *newly discovered* markets whose status is not "open".
   * Markets we already track still get a row when they leave open, so the
   * archive includes the close / resolution transition.
   */
  openMarketsOnly: boolean;
  /**
   * When true, only store markets listed in the shared watchlist
   * (`api/src/shared/watchlist.json`).
   */
  watchlistOnly: boolean;
  /**
   * Jupiter event categories to collect (e.g. `["crypto"]`).
   *
   * When non-empty the sweep calls `/events?category=…` instead of pulling
   * every market on the venue. Overrides `COLLECTOR_CATEGORIES` from `.env`
   * when set here. Empty means all categories — the previous default.
   */
  categories: string[];
  /**
   * After each sweep, refresh the shared watchlist (size N). Still-open ids stay
   * sticky until they close; free slots fill with markets that pass the paper
   * quote gate, prefer a 6h–14d horizon, and cap how many share one event title.
   * Open-but-useless ids (extreme price, surplus long-horizon, duplicate events)
   * accrue strikes and rotate out slowly. 0 keeps a manual watchlist.
   */
  autoWatchlistSize: number;
  /**
   * Max markets to re-check via GET /markets/{id} when they were open in our
   * archive but missing from this sweep's /events pages (pagination drop or
   * close). 0 disables follow-up. Keeps lifecycle coverage without WebSockets.
   */
  lifecycleFollowUpBatch: number;
}

/** Per-stream schedule plus the last successful fetch time written by the runner. */
export interface StreamSchedule {
  enabled: boolean;
  every: ScheduleInterval;
  /** ISO timestamp of the last successful fetch, or null if never run. */
  lastFetchAt: string | null;
  /** Last error message if the previous attempt failed, else null. */
  lastError: string | null;
  /** market_snapshots only — ignored by other streams. */
  options?: MarketSnapshotsOptions;
}

/**
 * Collector stream names = MongoDB collection names they contribute to.
 * `trades` already matched; the others were renamed to remove the mismatch.
 */
export type CollectorStreamName =
  | 'market_snapshots'
  | 'orderbook_snapshots'
  | 'trades'
  | 'market_labels';

/** Root shape of schedule.json (user-editable). */
export interface CollectorScheduleFile {
  enabled: boolean;
  comment?: string;
  /**
   * Stream cadences only. Market ids live in `api/src/shared/watchlist.json`
   * so the collector and swarm scheduler share one list without depending on
   * each other.
   */
  streams: Record<CollectorStreamName, StreamSchedule>;
}

/**
 * One price row from the market_snapshots stream (or a lifecycle follow-up).
 *
 * `capturedAt` is the wall-clock observation time when the collector saw this
 * quote — Jupiter does not expose a per-quote exchange timestamp on /events.
 * Use it to order replay; do not confuse it with Mongo insert time (they are
 * set together intentionally, before the write).
 */
export interface MarketSnapshotDoc {
  /** When PMTrader observed this quote (replay clock). */
  capturedAt: Date;
  marketId: string;
  eventId?: string;
  /** Event question from Jupiter (e.g. "Will Solana hit $200?"). */
  eventTitle?: string;
  category?: string;
  title: string;
  status: string;
  result: 'yes' | 'no' | null;
  buyYesPriceUsd: number;
  buyNoPriceUsd: number;
  sellYesPriceUsd: number;
  sellNoPriceUsd: number;
  volumeUsd: number;
  /** Unix seconds when the market opened for trading, when Jupiter provides it. */
  openTime: number | null;
  /** Unix seconds when the market closes / stops trading. */
  closeTime: number | null;
  /**
   * Hash of price/volume/status fields — used to skip duplicate polls.
   * Survives process restarts (unlike an in-memory-only fingerprint).
   */
  contentHash: string;
}

/** Raw orderbook capture — hash skips unchanged books. */
export interface OrderbookSnapshotDoc {
  /** When PMTrader observed this book (replay clock). */
  capturedAt: Date;
  marketId: string;
  yesDollars: Array<[string, number]>;
  noDollars: Array<[string, number]>;
  contentHash: string;
}

/** One fill from GET /trades. */
export interface TradeDoc {
  id: string;
  /** Jupiter fill time (true event time, not poll time). */
  timestamp: Date;
  marketId: string;
  ownerPubkey: string;
  action: 'buy' | 'sell';
  side: 'yes' | 'no';
  amountUsd: string;
  priceUsd: string;
  eventTitle?: string;
  marketTitle?: string;
  eventId?: string;
}

/** Resolution label when a market leaves open / gets a result. */
export interface MarketLabelDoc {
  marketId: string;
  eventId?: string;
  title: string;
  status: string;
  result: 'yes' | 'no' | null;
  closeTime: number | null;
  resolveAt?: string | null;
  labelledAt: Date;
}

/** Summary returned by each stream after a fetch. */
export interface StreamFetchResult {
  stream: CollectorStreamName;
  ok: boolean;
  message: string;
  rowsWritten?: number;
}
