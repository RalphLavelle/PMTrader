import { getAdaptiveTable, getAdaptiveTrades, setAdaptiveTable } from '../adaptive/index.js';
import type { AgentName } from '../schemas/index.js';
import type { CompletedFitnessTrade } from '../fitness/types.js';
import { config } from '../config.js';
import { runLivePaperPass } from './live-engine.js';
import type { LivePaperPassResult } from './live-types.js';
import {
  initLivePaperStore,
  loadAdaptiveSnapshot,
  saveAdaptiveSnapshot,
  summarisePortfolio,
} from './live-store.js';

/**
 * Continuous paper-trading scheduler.
 *
 * Self-rescheduling setTimeout (like the labeller) so passes cannot overlap.
 * PAPER TRADING ONLY — never submits real orders.
 */

let timer: NodeJS.Timeout | null = null;
let scheduled = false;
let passInFlight = false;
let lastPass: LivePaperPassResult | null = null;

/** Most recent pass, or null when none has run yet. */
export function getLastLivePaperPass(): LivePaperPassResult | null {
  return lastPass;
}

/** True while a pass is executing. */
export function isLivePaperPassRunning(): boolean {
  return passInFlight;
}

/** Restore adaptive weights from Mongo so restarts keep influence multipliers. */
async function hydrateAdaptiveFromMongo(): Promise<void> {
  const snapshot = await loadAdaptiveSnapshot();
  if (!snapshot) {
    return;
  }

  const tradesByAgent = new Map<AgentName, CompletedFitnessTrade[]>();
  for (const trade of snapshot.trades) {
    if (trade.owner === 'swarm') {
      continue;
    }
    const list = tradesByAgent.get(trade.owner) ?? [];
    list.push(trade);
    tradesByAgent.set(trade.owner, list);
  }

  setAdaptiveTable(snapshot.table, tradesByAgent);
  console.log(
    `[paper] Restored adaptive weights from Mongo (${snapshot.table.agents.length} agent(s), updated ${snapshot.updatedAt})`,
  );
}

/** Persist the in-memory adaptive table after a live refresh or fitness pass. */
export async function persistAdaptiveSnapshot(): Promise<void> {
  const table = getAdaptiveTable();
  if (!table) {
    return;
  }
  const trades: CompletedFitnessTrade[] = [];
  for (const list of getAdaptiveTrades().values()) {
    trades.push(...list);
  }
  await saveAdaptiveSnapshot(table, trades);
}

/**
 * Run one paper-trading pass.
 *
 * Never throws to the scheduler: failures are recorded on the result so status
 * endpoints stay useful after a partial failure.
 */
export async function runLivePaperPassOnce(): Promise<LivePaperPassResult> {
  if (passInFlight) {
    throw new Error('A live paper-trading pass is already running.');
  }

  passInFlight = true;
  try {
    await initLivePaperStore();
    const result = await runLivePaperPass();
    lastPass = result;

    // Persist weights whenever this pass closed trades (engine already refreshed).
    if (result.closedTrades > 0) {
      await persistAdaptiveSnapshot();
    }

    if (result.entries > 0 || result.exits > 0 || result.errors.length > 0) {
      const portfolio = await summarisePortfolio();
      console.log(
        `[paper] Pass complete — entries=${result.entries} exits=${result.exits} ` +
          `closed=${result.closedTrades} realised=${portfolio.realisedPnlUsd} ` +
          `open=${portfolio.openPositions} errors=${result.errors.length}`,
      );
    }

    return result;
  } finally {
    passInFlight = false;
  }
}

function scheduleNextPass(): void {
  timer = setTimeout(() => {
    void runLivePaperPassOnce()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[paper] Pass failed: ${message}`);
      })
      .finally(() => {
        if (scheduled) {
          scheduleNextPass();
        }
      });
  }, config.paperTradingIntervalMs);
}

/** Start the continuous paper loop when PAPER_TRADING_ENABLED=true. */
export async function startLivePaperTrading(): Promise<void> {
  if (!config.paperTradingEnabled || scheduled) {
    return;
  }

  await initLivePaperStore();
  await hydrateAdaptiveFromMongo();

  scheduled = true;
  const seconds = (config.paperTradingIntervalMs / 1_000).toFixed(0);
  console.log(
    `[paper] Started continuous paper trading — every ${seconds}s ` +
      `(decision cadence ${config.paperTradingDecisionIntervalMinutes}m, ` +
      `stale after ${Math.round(config.paperTradingStaleMs / 60_000)}m). PAPER ONLY.`,
  );
  scheduleNextPass();
}

/** Stop the loop (tests / graceful shutdown). */
export function stopLivePaperTrading(): void {
  scheduled = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
