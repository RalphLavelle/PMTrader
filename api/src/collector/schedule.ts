import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import type {
  CollectorScheduleFile,
  CollectorStreamName,
  ScheduleInterval,
  StreamSchedule,
  WideSweepOptions,
} from './types.js';

const STREAM_NAMES: CollectorStreamName[] = ['wideSweep', 'orderbook', 'trades', 'labels'];

/** Absolute path to the api/ package root (stable regardless of process.cwd()). */
function apiPackageRoot(): string {
  // schedule.ts lives at api/src/collector/ → go up two levels to api/
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
}

/**
 * Absolute path to collector-schedule.json.
 * Relative COLLECTOR_SCHEDULE_PATH values resolve against the api/ package dir
 * so `npm run dev:api` works from either the repo root or api/.
 */
export function scheduleFilePath(): string {
  if (config.collectorSchedulePath) {
    const configured = config.collectorSchedulePath;
    return isAbsolute(configured) ? configured : resolve(apiPackageRoot(), configured);
  }
  // Default: the checked-in file next to the collector source.
  return resolve(apiPackageRoot(), 'src/collector/collector-schedule.json');
}

/** Convert a schedule interval into milliseconds. */
export function intervalToMs(every: ScheduleInterval): number {
  const value = Math.max(1, Number(every.value) || 1);
  if (every.unit === 'minutes') {
    return value * 60_000;
  }
  return value * 1_000;
}

/** True when enough time has passed since lastFetchAt for the stream to run again. */
export function isStreamDue(stream: StreamSchedule, now = Date.now()): boolean {
  if (!stream.enabled) {
    return false;
  }
  if (!stream.lastFetchAt) {
    return true;
  }
  const last = Date.parse(stream.lastFetchAt);
  if (!Number.isFinite(last)) {
    return true;
  }
  return now - last >= intervalToMs(stream.every);
}

/** Default wide-sweep knobs — keep volume manageable on the Free tier. */
export function defaultWideSweepOptions(): WideSweepOptions {
  return {
    maxPages: 2,
    pageSize: 50,
    openMarketsOnly: true,
    watchlistOnly: false,
    categories: [],
    autoWatchlistSize: 0,
  };
}

function defaultStream(every: ScheduleInterval, withWideOptions = false): StreamSchedule {
  return {
    enabled: true,
    every,
    lastFetchAt: null,
    lastError: null,
    ...(withWideOptions ? { options: defaultWideSweepOptions() } : {}),
  };
}

/** Sensible defaults if the JSON file is missing or incomplete. */
export function defaultSchedule(): CollectorScheduleFile {
  return {
    enabled: true,
    comment:
      'Edit every.value / every.unit (seconds|minutes) per stream. lastFetchAt is updated by the API.',
    marketIds: [],
    streams: {
      wideSweep: defaultStream({ value: 30, unit: 'seconds' }, true),
      orderbook: defaultStream({ value: 15, unit: 'seconds' }),
      trades: defaultStream({ value: 5, unit: 'seconds' }),
      labels: defaultStream({ value: 5, unit: 'minutes' }),
    },
  };
}

function normaliseWideOptions(raw: Partial<WideSweepOptions> | undefined): WideSweepOptions {
  const base = defaultWideSweepOptions();
  if (!raw) {
    return base;
  }
  return {
    maxPages: Math.max(1, Number(raw.maxPages) || base.maxPages),
    pageSize: Math.max(1, Math.min(100, Number(raw.pageSize) || base.pageSize)),
    openMarketsOnly: raw.openMarketsOnly !== false,
    watchlistOnly: raw.watchlistOnly === true,
    categories: Array.isArray(raw.categories)
      ? raw.categories.map(String).map((value) => value.trim()).filter(Boolean)
      : base.categories,
    autoWatchlistSize: Math.max(
      0,
      Math.min(100, Number(raw.autoWatchlistSize) || base.autoWatchlistSize),
    ),
  };
}

function normaliseSchedule(raw: Partial<CollectorScheduleFile>): CollectorScheduleFile {
  const base = defaultSchedule();
  const streams = { ...base.streams };

  for (const name of STREAM_NAMES) {
    const incoming = raw.streams?.[name];
    if (!incoming) {
      continue;
    }
    const unit = incoming.every?.unit === 'minutes' ? 'minutes' : 'seconds';
    streams[name] = {
      enabled: incoming.enabled !== false,
      every: {
        value: Math.max(1, Number(incoming.every?.value) || streams[name].every.value),
        unit,
      },
      lastFetchAt: typeof incoming.lastFetchAt === 'string' ? incoming.lastFetchAt : null,
      lastError: typeof incoming.lastError === 'string' ? incoming.lastError : null,
    };
    if (name === 'wideSweep') {
      streams[name].options = normaliseWideOptions(incoming.options);
    }
  }

  return {
    enabled: raw.enabled !== false,
    comment: typeof raw.comment === 'string' ? raw.comment : base.comment,
    marketIds: Array.isArray(raw.marketIds)
      ? raw.marketIds.map(String).map((id) => id.trim()).filter(Boolean)
      : [],
    streams,
  };
}

/** Read the schedule from disk (creates defaults if the file is missing). */
export async function loadSchedule(): Promise<CollectorScheduleFile> {
  const path = scheduleFilePath();
  try {
    const text = await readFile(path, 'utf8');
    return normaliseSchedule(JSON.parse(text) as Partial<CollectorScheduleFile>);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      const schedule = defaultSchedule();
      await saveSchedule(schedule);
      return schedule;
    }
    throw error;
  }
}

/** Write the full schedule (including lastFetchAt / lastError) back to disk. */
export async function saveSchedule(schedule: CollectorScheduleFile): Promise<void> {
  const path = scheduleFilePath();
  const pretty = `${JSON.stringify(schedule, null, 2)}\n`;
  await writeFile(path, pretty, 'utf8');
}

/**
 * Record a stream attempt: always advances lastFetchAt so the interval acts as
 * backoff after failures too; clears or sets lastError accordingly.
 * Reloads the file first so manual edits to intervals are not overwritten.
 */
export async function recordStreamAttempt(
  stream: CollectorStreamName,
  result: { ok: boolean; error?: string },
): Promise<CollectorScheduleFile> {
  const schedule = await loadSchedule();
  const entry = schedule.streams[stream];
  entry.lastFetchAt = new Date().toISOString();
  entry.lastError = result.ok ? null : (result.error ?? 'Unknown error');
  await saveSchedule(schedule);
  return schedule;
}
