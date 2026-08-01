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
  /** OpenAI API key for LangGraph reasoning nodes (optional — scaffold uses placeholders without it). */
  openAiApiKey: process.env['OPENAI_API_KEY'] ?? '',
  /** Chat model used by the agent pipeline. */
  openAiModel: process.env['OPENAI_MODEL'] ?? 'gpt-4o-mini',
  /** When true, run scheduled market analysis for AGENT_MARKET_IDS. */
  agentScheduleEnabled: process.env['AGENT_SCHEDULE_ENABLED'] === 'true',
  /** Comma-separated market ids for the scheduler (e.g. POLY-3013350). */
  agentMarketIds: (process.env['AGENT_MARKET_IDS'] ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  /** Interval between scheduled analysis runs in milliseconds. */
  agentScheduleIntervalMs: Number(process.env['AGENT_SCHEDULE_INTERVAL_MS'] ?? 3_600_000),
  /** Analysis memory driver: 'memory' (default) or 'file'. */
  memoryDriver: process.env['MEMORY_DRIVER'] ?? 'memory',
  /** Path used by the 'file' memory driver. */
  memoryFilePath: resolve(repoRoot, process.env['MEMORY_FILE_PATH'] ?? 'data/analyses.json'),
  /** Largest stake the Risk Manager will ever recommend, in USD. */
  swarmMaxPositionUsd: Number(process.env['SWARM_MAX_POSITION_USD'] ?? 100),
  /** Smallest stake worth placing, in USD — mirrors Jupiter's $5 order minimum. */
  swarmMinPositionUsd: Number(process.env['SWARM_MIN_POSITION_USD'] ?? 5),
  /** Blended confidence a trade must clear before the Risk Manager approves it. */
  swarmMinConfidence: Number(process.env['SWARM_MIN_CONFIDENCE'] ?? 0.55),
  /** Safety cap on LangGraph steps so a handoff loop cannot run forever. */
  swarmRecursionLimit: Number(process.env['SWARM_RECURSION_LIMIT'] ?? 40),
};
