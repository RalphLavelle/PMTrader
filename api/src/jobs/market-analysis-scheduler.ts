import { config } from '../config.js';
import { runSwarmAnalysis } from '../swarm/index.js';

let timer: NodeJS.Timeout | null = null;

/** Start periodic swarm analysis when enabled via env. */
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
        const result = await runSwarmAnalysis({ marketId });
        const { recommendation, confidence } = result.record.recommendation;
        console.log(
          `[swarm] ${marketId} ${recommendation} confidence=${confidence.toFixed(2)} @ ${result.record.timestamp}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[swarm] Failed analysis for ${marketId}: ${message}`);
      }
    }
  };

  void runBatch();
  timer = setInterval(() => {
    void runBatch();
  }, config.agentScheduleIntervalMs);

  console.log(
    `[swarm] Scheduler started — ${config.agentMarketIds.length} market(s), every ${config.agentScheduleIntervalMs}ms`,
  );
}

/** Stop the scheduler (used in tests or graceful shutdown). */
export function stopMarketAnalysisScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
