import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Swarm scheduler watchlist — which markets get analysed on a timer.
 *
 * Lives in `markets.json` beside this file so a dozen crypto ids stay readable
 * in one place instead of a comma-separated line in `.env`.
 */

/** Shape of api/src/agents/markets.json */
export interface AgentMarketsFile {
  ids: string[];
}

const MARKETS_FILE = resolve(dirname(fileURLToPath(import.meta.url)), 'markets.json');

let cachedIds: string[] | null = null;

/** Absolute path to the checked-in watchlist file. */
export function agentMarketsFilePath(): string {
  return MARKETS_FILE;
}

function parseMarketsFile(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') {
    return [];
  }

  const ids = (raw as Partial<AgentMarketsFile>).ids;
  if (!Array.isArray(ids)) {
    return [];
  }

  return ids.map(String).map((id) => id.trim()).filter(Boolean);
}

/**
 * Market ids the swarm scheduler should analyse.
 *
 * Read once per process unless `reload` is true. Missing or invalid JSON yields
 * an empty list so the scheduler can log a clear warning rather than crash.
 */
export function loadAgentMarketIds(reload = false): string[] {
  if (cachedIds && !reload) {
    return cachedIds;
  }

  if (!existsSync(MARKETS_FILE)) {
    console.warn(`[agents] Watchlist not found: ${MARKETS_FILE}`);
    cachedIds = [];
    return cachedIds;
  }

  try {
    const text = readFileSync(MARKETS_FILE, 'utf8');
    cachedIds = parseMarketsFile(JSON.parse(text));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[agents] Failed to read watchlist ${MARKETS_FILE}: ${message}`);
    cachedIds = [];
  }

  return cachedIds;
}
