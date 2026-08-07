/**
 * Types for the Phase 1 research-dataset collector.
 *
 * Documents match docs/research-dataset.md. Features are NOT stored here —
 * they are computed later on read so definitions can change without re-collecting.
 */

/** How often a stream should run — edit value/unit in collector-schedule.json. */
export interface ScheduleInterval {
  value: number;
  unit: 'seconds' | 'minutes';
}

/** Extra knobs that only apply to the wide price sweep. */
export interface WideSweepOptions {
  /** How many /events pages to fetch per sweep (default 2). */
  maxPages: number;
  /** Events per page (default 50). */
  pageSize: number;
  /** When true, skip markets whose status is not "open". */
  openMarketsOnly: boolean;
  /** When true, only store markets listed in schedule.marketIds. */
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
   * After each sweep, replace `marketIds` with the top N open markets by
   * volume from the filtered set. Those ids drive the orderbook and labels
   * streams, so depth capture follows the liveliest crypto markets
   * automatically. 0 keeps a manual watchlist.
   */
  autoWatchlistSize: number;
}

/** Per-stream schedule plus the last successful fetch time written by the runner. */
export interface StreamSchedule {
  enabled: boolean;
  every: ScheduleInterval;
  /** ISO timestamp of the last successful fetch, or null if never run. */
  lastFetchAt: string | null;
  /** Last error message if the previous attempt failed, else null. */
  lastError: string | null;
  /** Wide-sweep only — ignored by other streams. */
  options?: WideSweepOptions;
}

export type CollectorStreamName = 'wideSweep' | 'orderbook' | 'trades' | 'labels';

/** Root shape of collector-schedule.json (user-editable). */
export interface CollectorScheduleFile {
  enabled: boolean;
  comment?: string;
  /** Markets used for deep orderbook polls and resolution labelling. */
  marketIds: string[];
  streams: Record<CollectorStreamName, StreamSchedule>;
}

/** One price row from the wide event sweep. */
export interface MarketSnapshotDoc {
  capturedAt: Date;
  marketId: string;
  eventId?: string;
  category?: string;
  title: string;
  status: string;
  result: 'yes' | 'no' | null;
  buyYesPriceUsd: number;
  buyNoPriceUsd: number;
  sellYesPriceUsd: number;
  sellNoPriceUsd: number;
  volumeUsd: number;
  closeTime: number | null;
}

/** Raw orderbook capture — hash skips unchanged books. */
export interface OrderbookSnapshotDoc {
  capturedAt: Date;
  marketId: string;
  yesDollars: Array<[string, number]>;
  noDollars: Array<[string, number]>;
  contentHash: string;
}

/** One fill from GET /trades. */
export interface TradeDoc {
  id: string;
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
