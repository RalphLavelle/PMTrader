import { agentMarketsFilePath, loadAgentMarketIds } from '../agents/markets.js';
import { config } from '../config.js';
import { runSwarmAnalysis } from '../swarm/index.js';

let timer: NodeJS.Timeout | null = null;

/** Start periodic swarm analysis when enabled via env. */
export function startMarketAnalysisScheduler(): void {
  if (!config.agentScheduleEnabled) {
    return;
  }

  const marketIds = loadAgentMarketIds();
  if (marketIds.length === 0) {
    console.warn(
      `AGENT_SCHEDULE_ENABLED is true but ${agentMarketsFilePath()} has no ids — scheduler idle.`,
    );
    return;
  }

  const runBatch = async (): Promise<void> => {
    for (const marketId of marketIds) {
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
    `[swarm] Scheduler started — ${marketIds.length} market(s) from ${agentMarketsFilePath()}, every ${config.agentScheduleIntervalMs}ms`,
  );
}

/** Stop the scheduler (used in tests or graceful shutdown). */
export function stopMarketAnalysisScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
