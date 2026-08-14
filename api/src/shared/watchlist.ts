import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shared market watchlist — one JSON file used by:
 * - collector (orderbook_snapshots + market_labels; auto-refresh writes here)
 * - swarm scheduler (which markets to analyse on a timer)
 * - paper trading (preferred universe)
 *
 * Neither the collector nor the agents package "owns" the list; both depend on
 * this shared module so the ids stay in one place.
 */

export interface WatchlistFile {
  comment?: string;
  marketIds: string[];
  /**
   * Consecutive sweeps a sticky id failed the learning tests (incoherent quote,
   * extreme price, too many siblings of the same event, or a surplus long-horizon
   * slot). Cleared when the market looks healthy again. Used for slow rotation.
   */
  strikes?: Record<string, number>;
}

const WATCHLIST_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'watchlist.json',
);

const DEFAULT_COMMENT =
  'Shared market watchlist. Collector auto-refresh and swarm/paper readers use this file.';

/** Absolute path to api/src/shared/watchlist.json. */
export function watchlistFilePath(): string {
  return WATCHLIST_FILE;
}

function parseMarketIds(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') {
    return [];
  }

  const marketIds = (raw as Partial<WatchlistFile>).marketIds;
  // Older agents/markets.json used `{ "ids": [...] }` — accept that once during migration.
  const legacyIds = (raw as { ids?: unknown }).ids;
  const list = Array.isArray(marketIds)
    ? marketIds
    : Array.isArray(legacyIds)
      ? legacyIds
      : [];

  return list.map(String).map((id) => id.trim()).filter(Boolean);
}

function parseStrikes(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = id.trim();
    const count = Number(value);
    if (!key || !Number.isFinite(count) || count <= 0) {
      continue;
    }
    out[key] = Math.trunc(count);
  }
  return out;
}

function emptyWatchlist(): WatchlistFile {
  return { comment: DEFAULT_COMMENT, marketIds: [], strikes: {} };
}

/**
 * Read the full watchlist document (ids + soft-evict strikes).
 *
 * Always hits disk (no long-lived cache) so the swarm scheduler sees collector
 * auto-refresh updates without an API restart.
 */
export async function loadWatchlistFile(): Promise<WatchlistFile> {
  try {
    const text = await readFile(WATCHLIST_FILE, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    return {
      comment: DEFAULT_COMMENT,
      ...((parsed && typeof parsed === 'object' ? parsed : {}) as Partial<WatchlistFile>),
      marketIds: parseMarketIds(parsed),
      strikes: parseStrikes(
        parsed && typeof parsed === 'object'
          ? (parsed as Partial<WatchlistFile>).strikes
          : undefined,
      ),
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      console.warn(`[watchlist] File not found: ${WATCHLIST_FILE}`);
      return emptyWatchlist();
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[watchlist] Failed to read ${WATCHLIST_FILE}: ${message}`);
    return emptyWatchlist();
  }
}

/** Read market ids from the shared watchlist file. */
export async function loadWatchlist(): Promise<string[]> {
  return (await loadWatchlistFile()).marketIds;
}

function pruneStrikes(
  strikes: Record<string, number> | undefined,
  marketIds: string[],
): Record<string, number> {
  const keep = new Set(marketIds);
  const next: Record<string, number> = {};
  for (const [id, count] of Object.entries(strikes ?? {})) {
    if (keep.has(id) && count > 0) {
      next[id] = count;
    }
  }
  return next;
}

/** Replace the watchlist on disk (pretty-printed for easy hand edits). */
export async function saveWatchlist(
  marketIds: string[],
  strikes?: Record<string, number>,
): Promise<void> {
  const clean = [...new Set(marketIds.map(String).map((id) => id.trim()).filter(Boolean))];
  let comment = DEFAULT_COMMENT;
  let previousStrikes: Record<string, number> = {};
  try {
    const existing = JSON.parse(await readFile(WATCHLIST_FILE, 'utf8')) as Partial<WatchlistFile>;
    if (typeof existing.comment === 'string' && existing.comment.trim()) {
      comment = existing.comment;
    }
    previousStrikes = parseStrikes(existing.strikes);
  } catch {
    // First write or unreadable file — use the default comment.
  }

  const nextStrikes = pruneStrikes(strikes ?? previousStrikes, clean);
  const doc: WatchlistFile = { comment, marketIds: clean };
  if (Object.keys(nextStrikes).length > 0) {
    doc.strikes = nextStrikes;
  }
  await writeFile(WATCHLIST_FILE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}
