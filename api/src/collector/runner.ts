import { config } from '../config.js';
import {
  isStreamDue,
  loadSchedule,
  recordStreamAttempt,
  scheduleFilePath,
} from './schedule.js';
import { initCollectorStore } from './store.js';
import { effectiveCategories } from './category-filter.js';
import {
  fetchLabels,
  fetchOrderbooks,
  fetchTrades,
  fetchWideSweep,
} from './streams.js';
import type {
  CollectorScheduleFile,
  CollectorStreamName,
  StreamFetchResult,
} from './types.js';

/** How often the runner re-reads the JSON schedule and checks due streams. */
const TICK_MS = 1_000;

let tickTimer: NodeJS.Timeout | null = null;
/** Prevents overlapping ticks when a fetch takes longer than TICK_MS. */
let tickInFlight = false;

type StreamRunner = (schedule: CollectorScheduleFile) => Promise<StreamFetchResult>;

const STREAM_RUNNERS: Record<CollectorStreamName, StreamRunner> = {
  wideSweep: (schedule) => fetchWideSweep(schedule),
  orderbook: (schedule) => fetchOrderbooks(schedule),
  trades: (schedule) => fetchTrades(schedule),
  labels: (schedule) => fetchLabels(schedule),
};

const STREAM_ORDER: CollectorStreamName[] = ['wideSweep', 'orderbook', 'trades', 'labels'];

/** Run one stream, log the result, and persist lastFetchAt / lastError. */
async function runStream(
  name: CollectorStreamName,
  schedule: CollectorScheduleFile,
): Promise<void> {
  try {
    const result = await STREAM_RUNNERS[name](schedule);
    if (result.ok) {
      console.log(`[collector:${name}] ${result.message}`);
      await recordStreamAttempt(name, { ok: true });
    } else {
      console.error(`[collector:${name}] ${result.message}`);
      await recordStreamAttempt(name, { ok: false, error: result.message });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[collector:${name}] Failed: ${message}`);
    await recordStreamAttempt(name, { ok: false, error: message });
  }
}

/**
 * Startup smoke test: fetch every enabled stream once so you can see data land
 * in MongoDB before the JSON schedule takes over.
 */
async function runInitialFetch(schedule: CollectorScheduleFile): Promise<void> {
  console.log('[collector] Running initial fetch for all enabled streams…');
  for (const name of STREAM_ORDER) {
    if (!schedule.streams[name].enabled) {
      console.log(`[collector:${name}] Skipped (disabled in schedule)`);
      continue;
    }
    await runStream(name, schedule);
  }
  console.log('[collector] Initial fetch complete — further runs follow collector-schedule.json');
}

/** Periodic tick: reload JSON, run any stream whose interval has elapsed. */
async function tick(): Promise<void> {
  if (tickInFlight) {
    return;
  }
  tickInFlight = true;
  try {
    const schedule = await loadSchedule();
    if (!schedule.enabled) {
      return;
    }

    for (const name of STREAM_ORDER) {
      const stream = schedule.streams[name];
      if (!isStreamDue(stream)) {
        continue;
      }
      // Re-load before each stream so interval edits apply mid-batch.
      const latest = await loadSchedule();
      if (!latest.enabled || !latest.streams[name].enabled) {
        continue;
      }
      await runStream(name, latest);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[collector] Tick failed: ${message}`);
  } finally {
    tickInFlight = false;
  }
}

/**
 * Start the research-dataset collector when COLLECTOR_ENABLED=true.
 * Schedule intervals and last fetch times live in collector-schedule.json.
 */
export async function startCollector(): Promise<void> {
  if (!config.collectorEnabled) {
    return;
  }

  await initCollectorStore();
  const schedule = await loadSchedule();
  const path = scheduleFilePath();
  const categories = effectiveCategories(schedule.streams.wideSweep.options);

  console.log(`[collector] Schedule file: ${path}`);
  if (categories.length > 0) {
    console.log(`[collector] Category filter: ${categories.join(', ')}`);
  }
  console.log(
    `[collector] Watching ${schedule.marketIds.length} market id(s) for orderbook/labels`,
  );

  if (!schedule.enabled) {
    console.log('[collector] Schedule has enabled=false — idle until you flip it to true');
  }

  // One immediate pass so you can verify Mongo rows without waiting for intervals.
  if (schedule.enabled) {
    await runInitialFetch(schedule);
  }

  tickTimer = setInterval(() => {
    void tick();
  }, TICK_MS);

  console.log(`[collector] Scheduler started — checking due streams every ${TICK_MS}ms`);
}

/** Stop the collector tick loop (tests / graceful shutdown). */
export function stopCollector(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}
