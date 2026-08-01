import { config } from '../config.js';
import { runMarketAnalysis } from '../agent/index.js';

let timer: NodeJS.Timeout | null = null;

/** Start periodic market analysis when enabled via env. */
export function startMarketAnalysisScheduler(): void {
  if (!config.agentScheduleEnabled) {
    return;
  }

  if (config.agentMarketIds.length === 0) {
    console.warn('AGENT_SCHEDULE_ENABLED is true but AGENT_MARKET_IDS is empty — scheduler idle.');
    return;
  }

  const runBatch = async (): Promise<void> => {
    for (const marketId of config.agentMarketIds) {
      try {
        const result = await runMarketAnalysis({ marketId });
        console.log(
          `[agent] ${marketId} yes=${(result.yesLikelihood * 100).toFixed(1)}% @ ${result.analyzedAt}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[agent] Failed analysis for ${marketId}: ${message}`);
      }
    }
  };

  void runBatch();
  timer = setInterval(() => {
    void runBatch();
  }, config.agentScheduleIntervalMs);

  console.log(
    `[agent] Scheduler started — ${config.agentMarketIds.length} market(s), every ${config.agentScheduleIntervalMs}ms`,
  );
}

/** Stop the scheduler (used in tests or graceful shutdown). */
export function stopMarketAnalysisScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
