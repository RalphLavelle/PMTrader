import { loadWatchlist, watchlistFilePath } from '../shared/watchlist.js';
import { config } from '../config.js';
import { runSwarmAnalysis } from '../swarm/index.js';
import { llmBackoffUntil } from '../llm/quota.js';

let timer: NodeJS.Timeout | null = null;

/** Start periodic swarm analysis when enabled via env. */
export function startMarketAnalysisScheduler(): void {
  if (!config.agentScheduleEnabled) {
    return;
  }

  const runBatch = async (): Promise<void> => {
    // Reload each pass so collector auto-refresh of the shared watchlist is seen.
    const marketIds = await loadWatchlist();
    if (marketIds.length === 0) {
      console.warn(
        `AGENT_SCHEDULE_ENABLED is true but ${watchlistFilePath()} has no ids — batch skipped.`,
      );
      return;
    }

    const backoffUntil = llmBackoffUntil();
    if (backoffUntil) {
      console.warn(
        `[swarm] LLM backing off until ${backoffUntil.toISOString()} — this batch is deterministic.`,
      );
    }

    for (const marketId of marketIds) {
      try {
        const result = await runSwarmAnalysis({ marketId });
        const { recommendation, confidence } = result.record.recommendation;
        console.log(
          `[swarm] ${marketId} ${recommendation} confidence=${confidence.toFixed(2)} ` +
            `mode=${result.record.mode} @ ${result.record.timestamp}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[swarm] Failed analysis for ${marketId}: ${message}`);
      }
    }
  };

  void (async () => {
    const marketIds = await loadWatchlist();
    if (marketIds.length === 0) {
      console.warn(
        `AGENT_SCHEDULE_ENABLED is true but ${watchlistFilePath()} has no ids — scheduler started but idle until ids appear.`,
      );
    } else {
      console.log(
        `[swarm] Scheduler started — ${marketIds.length} market(s) from ${watchlistFilePath()}, every ${config.agentScheduleIntervalMs}ms`,
      );
    }
    await runBatch();
  })();

  timer = setInterval(() => {
    void runBatch();
  }, config.agentScheduleIntervalMs);
}

/** Stop the scheduler (used in tests or graceful shutdown). */
export function stopMarketAnalysisScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
