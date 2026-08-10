import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from the repo root so one file serves both api and web.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
loadEnv({ path: resolve(repoRoot, '.env') });

export const config = {
  port: Number(process.env['PORT'] ?? 3000),
  jupiterApiKey: process.env['JUPITER_API_KEY'] ?? '',
  jupiterBaseUrl: process.env['JUPITER_BASE_URL'] ?? 'https://api.jup.ag/prediction/v1',
  /**
   * Minimum milliseconds between Jupiter HTTP calls process-wide.
   * Default ~54/min with an API key, ~30/min keyless. Override when your
   * portal tier allows a higher sustained rate.
   */
  jupiterMinRequestIntervalMs: Number(
    process.env['JUPITER_MIN_REQUEST_INTERVAL_MS'] ??
      (process.env['JUPITER_API_KEY'] ? 1_100 : 2_000),
  ),
  /** How many times to retry a call after HTTP 429 before surfacing the error. */
  jupiter429MaxRetries: Number(process.env['JUPITER_429_MAX_RETRIES'] ?? 2),
  /** Base backoff (ms) after 429; multiplied by attempt number (1×, 2×, …). */
  jupiter429RetryDelayMs: Number(process.env['JUPITER_429_RETRY_DELAY_MS'] ?? 5_000),
  /** Optional default wallet for history/position queries. */
  ownerPubkey: process.env['OWNER_PUBKEY'] ?? '',
  /** Solana RPC URL exposed to the frontend for transaction fallback. */
  solanaRpcUrl: process.env['SOLANA_RPC_URL'] ?? 'https://api.mainnet-beta.solana.com',
  /** Ollama OpenAI-compatible API base URL (e.g. http://127.0.0.1:11434/v1). */
  ollamaBaseUrl: process.env['OLLAMA_BASE_URL'] ?? '',
  /** API key for Ollama Cloud; local Ollama accepts any placeholder. */
  ollamaApiKey: process.env['OLLAMA_API_KEY'] ?? '',
  /** Chat model used by the swarm and semantic analysis. */
  ollamaModel: process.env['OLLAMA_MODEL'] ?? '',
  /** True when Ollama base URL and model are configured. */
  llmConfigured: Boolean(process.env['OLLAMA_BASE_URL'] && process.env['OLLAMA_MODEL']),
  /** When true, run scheduled market analysis for ids in agents/markets.json. */
  agentScheduleEnabled: process.env['AGENT_SCHEDULE_ENABLED'] === 'true',
  /** Interval between scheduled analysis runs in milliseconds. */
  agentScheduleIntervalMs: Number(process.env['AGENT_SCHEDULE_INTERVAL_MS'] ?? 3_600_000),
  /** MongoDB connection string for persisting swarm runs. */
  mongodbUri: (process.env['MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/').replace(
    '://localhost',
    '://127.0.0.1',
  ),
  /** Database that stores completed analysis runs. */
  mongodbDatabase: process.env['MONGODB_DATABASE'] ?? 'PRMTrade',
  /** Collection that stores completed analysis runs. */
  mongodbRunsCollection: process.env['MONGODB_RUNS_COLLECTION'] ?? 'runs',
  /** Largest stake the Risk Manager will ever recommend, in USD. */
  swarmMaxPositionUsd: Number(process.env['SWARM_MAX_POSITION_USD'] ?? 100),
  /** Smallest stake worth placing, in USD — mirrors Jupiter's $5 order minimum. */
  swarmMinPositionUsd: Number(process.env['SWARM_MIN_POSITION_USD'] ?? 5),
  /** Blended confidence a trade must clear before the Risk Manager approves it. */
  swarmMinConfidence: Number(process.env['SWARM_MIN_CONFIDENCE'] ?? 0.55),
  /** Safety cap on LangGraph steps so a handoff loop cannot run forever. */
  swarmRecursionLimit: Number(process.env['SWARM_RECURSION_LIMIT'] ?? 40),
  /** When true, start the research-dataset collector on API boot. */
  collectorEnabled: process.env['COLLECTOR_ENABLED'] === 'true',
  /**
   * Default Jupiter categories to collect when the schedule does not override
   * `wideSweep.options.categories`. Example: `crypto` or `crypto,sports`.
   * Empty means all categories.
   */
  collectorCategories: (process.env['COLLECTOR_CATEGORIES'] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  /**
   * Optional absolute/relative path to collector-schedule.json.
   * Empty → repo-root collector-schedule.json.
   */
  collectorSchedulePath: process.env['COLLECTOR_SCHEDULE_PATH'] ?? '',
  /** MongoDB collection for wide-sweep price rows. */
  mongodbMarketSnapshotsCollection:
    process.env['MONGODB_MARKET_SNAPSHOTS_COLLECTION'] ?? 'market_snapshots',
  /** MongoDB collection for deep orderbook captures. */
  mongodbOrderbookSnapshotsCollection:
    process.env['MONGODB_ORDERBOOK_SNAPSHOTS_COLLECTION'] ?? 'orderbook_snapshots',
  /** MongoDB collection for global trade fills. */
  mongodbTradesCollection: process.env['MONGODB_TRADES_COLLECTION'] ?? 'trades',
  /** MongoDB collection for market resolution labels. */
  mongodbMarketLabelsCollection:
    process.env['MONGODB_MARKET_LABELS_COLLECTION'] ?? 'market_labels',
  /** When true, start the Phase 3 outcome labeller on API boot. */
  labellerEnabled: process.env['LABELLER_ENABLED'] === 'true',
  /** Gap between labelling passes in milliseconds (default 10 minutes). */
  labellerIntervalMs: Number(process.env['LABELLER_INTERVAL_MS'] ?? 600_000),
  /**
   * Markets queried per pass. Each one costs a Jupiter request from the same
   * 60/min Free-tier budget the UI, swarm, and collector share.
   */
  labellerMarketBatchSize: Number(process.env['LABELLER_MARKET_BATCH_SIZE'] ?? 5),
  /** Unscored runs examined per pass. Cheap — MongoDB only, no Jupiter calls. */
  labellerRunBatchSize: Number(process.env['LABELLER_RUN_BATCH_SIZE'] ?? 100),
  /**
   * Phase 4 backtest defaults. There is no enable flag because the backtest
   * never runs on a timer: it is on demand only, reads MongoDB, and makes no
   * Jupiter calls, so it cannot eat the shared rate-limit budget.
   */
  /** Resolved markets replayed per backtest run. */
  backtestMaxMarkets: Number(process.env['BACKTEST_MAX_MARKETS'] ?? 50),
  /** Minutes between decision points within one market's history. */
  backtestDecisionIntervalMinutes: Number(
    process.env['BACKTEST_DECISION_INTERVAL_MINUTES'] ?? 15,
  ),
  /** Fewest snapshots a market needs before replaying it is meaningful. */
  backtestMinSnapshots: Number(process.env['BACKTEST_MIN_SNAPSHOTS'] ?? 3),
  /** Snapshots loaded per market — caps memory on long-running markets. */
  backtestMaxSnapshotsPerMarket: Number(
    process.env['BACKTEST_MAX_SNAPSHOTS_PER_MARKET'] ?? 2_000,
  ),
  /**
   * Minutes to hold a hypothetical position before exiting at the next quote.
   * Defaults to the decision interval when unset (exit at the next cadence).
   */
  backtestExitHoldMinutes: process.env['BACKTEST_EXIT_HOLD_MINUTES']
    ? Number(process.env['BACKTEST_EXIT_HOLD_MINUTES'])
    : undefined,
  /**
   * Phase 5 agent fitness. On demand only, like the backtest — it paper-replays
   * markets for coherent trades and keeps resolution Brier as a secondary view.
   */
  /** Stored swarm runs examined per pass; the only source that grades semantic. */
  fitnessMaxRuns: Number(process.env['FITNESS_MAX_RUNS'] ?? 500),
  /**
   * Fewest completed paper trades before a suggested weight stops being pinned at 1.0.
   *
   * A dozen trades can produce a spectacular score by luck, and Phase 6 acting
   * on luck would be worse than Phase 6 doing nothing.
   */
  fitnessMinSampleForWeight: Number(process.env['FITNESS_MIN_SAMPLE_FOR_WEIGHT'] ?? 30),
  /** Unit stake when simulating each specialist's own paper book. */
  fitnessSpecialistStakeUsd: Number(process.env['FITNESS_SPECIALIST_STAKE_USD'] ?? 10),

  /**
   * Phase 6 adaptive weighting — how hard fitness scores may push influence
   * away from the baseline of 1.0 (keep small for gradual adaptation).
   */
  adaptiveSensitivity: Number(process.env['ADAPTIVE_SENSITIVITY'] ?? 0.4),
  /** Most-recent trades that define "recent" fitness. */
  adaptiveRecentWindow: Number(process.env['ADAPTIVE_RECENT_WINDOW'] ?? 10),
  /**
   * Blend toward the previously published weight (0 = jump, 1 = freeze).
   * Default 0.6 means 40% of each pass's raw move is applied.
   */
  adaptiveInertia: Number(process.env['ADAPTIVE_INERTIA'] ?? 0.6),
  /** Pseudocounts on wins and losses so one trade cannot pin win rate at 0 or 1. */
  adaptiveWinRatePrior: Number(process.env['ADAPTIVE_WIN_RATE_PRIOR'] ?? 1),

  /**
   * Paper execution model — keep conservative so backtests are not flattering.
   * See api/src/trading/fill-model.ts and README "Fill model".
   */
  /** partial_fill | reject_excess when depth cannot cover the full order. */
  paperExcessMode: (process.env['PAPER_EXCESS_MODE'] ?? 'partial_fill') as
    | 'partial_fill'
    | 'reject_excess',
  /** Extra adverse slippage after the book walk / top-of-book (basis points). */
  paperSlippageBps: Number(process.env['PAPER_SLIPPAGE_BPS'] ?? 10),
  /** Flat fee on filled notional per leg (basis points). */
  paperFeeBps: Number(process.env['PAPER_FEE_BPS'] ?? 0),
  /**
   * When no orderbook ladder exists at T, assume at most this much USD can
   * trade at the top-of-book quote (prevents infinite-depth mid fantasies).
   */
  paperNoBookDepthUsd: Number(process.env['PAPER_NO_BOOK_DEPTH_USD'] ?? 25),
  /** Reject the whole order when filled fraction is below this (0–1). */
  paperMinFillFraction: Number(process.env['PAPER_MIN_FILL_FRACTION'] ?? 0.25),

  /**
   * Continuous live paper-trading loop (Phase 7) — PAPER ONLY, no real orders.
   * Consumes collector tips; persists portfolios in Mongo across restarts.
   */
  paperTradingEnabled: process.env['PAPER_TRADING_ENABLED'] === 'true',
  /** Gap between paper-trading passes (default 60s). */
  paperTradingIntervalMs: Number(process.env['PAPER_TRADING_INTERVAL_MS'] ?? 60_000),
  /**
   * Minimum minutes between decision-engine runs on the same market.
   * Mark-to-market still runs every pass when a new observation arrives.
   */
  paperTradingDecisionIntervalMinutes: Number(
    process.env['PAPER_TRADING_DECISION_INTERVAL_MINUTES'] ?? 15,
  ),
  /**
   * Skip new decisions when the latest collector tip is older than this
   * (milliseconds). Open positions are still marked / force-closed on status.
   */
  paperTradingStaleMs: Number(process.env['PAPER_TRADING_STALE_MS'] ?? 900_000),
  /** Max open markets processed per pass (plus any markets with open positions). */
  paperTradingMaxMarkets: Number(process.env['PAPER_TRADING_MAX_MARKETS'] ?? 24),
  /** Mongo collection for per-market paper portfolios. */
  mongodbPaperPortfoliosCollection:
    process.env['MONGODB_PAPER_PORTFOLIOS_COLLECTION'] ?? 'paper_portfolios',
  /** Mongo collection for live paper decision audit rows. */
  mongodbPaperDecisionsCollection:
    process.env['MONGODB_PAPER_DECISIONS_COLLECTION'] ?? 'paper_decisions',
  /** Mongo collection for live closed paper trades. */
  mongodbPaperClosedTradesCollection:
    process.env['MONGODB_PAPER_CLOSED_TRADES_COLLECTION'] ?? 'paper_closed_trades',
  /** Mongo collection for the published adaptive weight snapshot. */
  mongodbAdaptiveWeightsCollection:
    process.env['MONGODB_ADAPTIVE_WEIGHTS_COLLECTION'] ?? 'adaptive_weights',
  /** Mongo collection for the cached Jupiter events catalog (Markets page). */
  mongodbEventsCatalogCollection:
    process.env['MONGODB_EVENTS_CATALOG_COLLECTION'] ?? 'events_catalog',
};
