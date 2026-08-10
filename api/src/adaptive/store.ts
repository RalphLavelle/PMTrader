import type { FitnessReport, CompletedFitnessTrade } from '../fitness/types.js';
import type { AgentName } from '../schemas/index.js';
import { buildAdaptiveWeightTable, toWeightMap } from './weights.js';
import type {
  AdaptiveWeightTable,
  AgentWeightMap,
  RegimeContext,
} from './types.js';

/**
 * In-memory adaptive weight store.
 *
 * Fitness passes replace the evidence set. Live paper closes *append* specialist
 * trades and rebuild with inertia. Callers may also hydrate from Mongo on boot
 * so a restart does not reset influence multipliers to baseline.
 */

let currentTable: AdaptiveWeightTable | null = null;
let lastTradesByAgent: Map<AgentName, CompletedFitnessTrade[]> = new Map();

/** Last published table, or null before the first fitness-driven refresh. */
export function getAdaptiveTable(): AdaptiveWeightTable | null {
  return currentTable;
}

/** Trade evidence the current table was built from (for regime re-queries). */
export function getAdaptiveTrades(): Map<AgentName, CompletedFitnessTrade[]> {
  return lastTradesByAgent;
}

/** Replace the published table (used by tests and explicit refresh). */
export function setAdaptiveTable(
  table: AdaptiveWeightTable | null,
  trades?: Map<AgentName, CompletedFitnessTrade[]>,
): void {
  currentTable = table;
  if (trades) {
    lastTradesByAgent = trades;
  } else if (table === null) {
    lastTradesByAgent = new Map();
  }
}

/** Influence map for aggregateSignals — empty map means everyone at baseline. */
export function getAgentWeightMap(): AgentWeightMap {
  return toWeightMap(currentTable);
}

/**
 * Rebuild weights from a fitness report's specialist trades.
 *
 * Applies inertia against the previously published table so one pass cannot
 * yank every weight to a new extreme.
 */
export function refreshAdaptiveFromFitness(report: FitnessReport): AdaptiveWeightTable {
  const tradesByAgent = new Map<AgentName, CompletedFitnessTrade[]>();

  for (const agent of report.agents) {
    tradesByAgent.set(agent.agent, agent.trades);
  }

  const table = buildAdaptiveWeightTable({
    tradesByAgent,
    previous: currentTable,
  });
  table.sourceFitnessAt = report.finishedAt;
  currentTable = table;
  lastTradesByAgent = tradesByAgent;
  return table;
}

/**
 * Append newly closed live paper trades and republish weights.
 *
 * Only specialist-owned trades move influence (same as a fitness pass).
 * Swarm rows are ignored here — they feed fitness dashboards, not weights.
 * Dedupes by marketId+owner+entryAt+exitAt so a retry cannot double-count.
 */
export function refreshAdaptiveFromLiveTrades(
  newTrades: CompletedFitnessTrade[],
): AdaptiveWeightTable {
  const tradesByAgent = new Map<AgentName, CompletedFitnessTrade[]>();

  for (const [agent, existing] of lastTradesByAgent) {
    tradesByAgent.set(agent, [...existing]);
  }

  for (const trade of newTrades) {
    if (trade.owner === 'swarm') {
      continue;
    }
    const agent = trade.owner;
    const list = tradesByAgent.get(agent) ?? [];
    const key = `${trade.marketId}|${trade.entryAt}|${trade.exitAt}`;
    const already = list.some(
      (row) => `${row.marketId}|${row.entryAt}|${row.exitAt}` === key,
    );
    if (!already) {
      list.push(trade);
      tradesByAgent.set(agent, list);
    }
  }

  const table = buildAdaptiveWeightTable({
    tradesByAgent,
    previous: currentTable,
  });
  table.sourceFitnessAt = new Date().toISOString();
  currentTable = table;
  lastTradesByAgent = tradesByAgent;
  return table;
}

/**
 * Recompute weights conditioned on the current market's regime.
 *
 * Answers: "How has this agent historically performed when the market looked
 * like this?" Does not overwrite the published overall table.
 */
export function weightsForRegime(context: RegimeContext): AdaptiveWeightTable | null {
  if (lastTradesByAgent.size === 0) {
    return null;
  }

  const table = buildAdaptiveWeightTable({
    tradesByAgent: lastTradesByAgent,
    previous: currentTable,
    regimeContext: context,
  });
  table.sourceFitnessAt = currentTable?.sourceFitnessAt ?? null;
  return table;
}
