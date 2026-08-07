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
   * Phase 5 agent fitness. On demand only, like the backtest — it replays the
   * same history and additionally reads stored runs, all from MongoDB.
   */
  /** Stored swarm runs examined per pass; the only source that grades semantic. */
  fitnessMaxRuns: Number(process.env['FITNESS_MAX_RUNS'] ?? 500),
  /**
   * Fewest graded stances before a suggested weight stops being pinned at 1.0.
   *
   * A dozen stances can produce a spectacular score by luck, and Phase 6 acting
   * on luck would be worse than Phase 6 doing nothing.
   */
  fitnessMinSampleForWeight: Number(process.env['FITNESS_MIN_SAMPLE_FOR_WEIGHT'] ?? 30),
};
