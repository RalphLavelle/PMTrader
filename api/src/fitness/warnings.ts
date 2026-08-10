import { AGENT_NAMES } from '../agents/names.js';
import type {
  AgentFitness,
  FitnessOptions,
  GradedStance,
  SourceSummary,
  TradingPerformance,
} from './types.js';

/**
 * Caveats that stop a fitness report being read as more than it is.
 */

const LOW_DEPTH_SHARE = 0.5;
const OVERCONFIDENCE_LIMIT = 0.15;
const LOPSIDED_SHARE = 0.8;
const OUTCOME_BALANCE_LIMIT = 0.8;
const FLAT_PRICE_SHARE = 0.9;

function flatPriceShare(stances: GradedStance[]): number | null {
  if (stances.length === 0) {
    return null;
  }
  const flat = stances.filter((stance) => Math.abs(stance.marketYes - 0.5) < 1e-6).length;
  return flat / stances.length;
}

function depthShare(stances: GradedStance[]): number | null {
  if (stances.length === 0) {
    return null;
  }
  return stances.filter((stance) => stance.hadOrderbook).length / stances.length;
}

function lopsidedShare(stances: GradedStance[]): number | null {
  if (stances.length === 0) {
    return null;
  }
  const lopsided = stances.filter(
    (stance) => Math.abs(stance.marketYes - 0.5) > 0.3,
  ).length;
  return lopsided / stances.length;
}

function yesShare(stances: GradedStance[]): number | null {
  const resolved = stances.filter(
    (s) => s.resolvedTo === 'yes' || s.resolvedTo === 'no',
  );
  if (resolved.length === 0) {
    return null;
  }
  return resolved.filter((stance) => stance.resolvedTo === 'yes').length / resolved.length;
}

function outcomeBalanceWarning(stances: GradedStance[]): string | null {
  const share = yesShare(stances);
  if (share === null) {
    return null;
  }

  const majority = Math.max(share, 1 - share);
  if (majority <= OUTCOME_BALANCE_LIMIT) {
    return null;
  }

  const side = share > 0.5 ? 'YES' : 'NO';
  return `${(majority * 100).toFixed(0)}% of resolved markets settled ${side}. Prefer coherent paper-trade P&L over resolution accuracy until the sample balances.`;
}

function sampleWarnings(
  stances: GradedStance[],
  sources: SourceSummary[],
  options: FitnessOptions,
  swarm: TradingPerformance,
): string[] {
  const warnings: string[] = [];

  if (swarm.trades === 0 && stances.length === 0) {
    warnings.push(
      'No coherent paper trades and no forecasting stances could be graded. Leave the collector running so markets have open-path snapshots.',
    );
    return warnings;
  }

  if (swarm.trades === 0) {
    warnings.push(
      'The swarm paper book closed zero trades. Primary trading fitness is empty until the replay opens and exits positions.',
    );
  }

  const paper = sources.find((source) => source.source === 'paper_replay');
  if (paper && paper.stances === 0) {
    warnings.push(
      'Paper replay produced no completed trades for specialists either — fitness weights fall back to secondary forecasting metrics.',
    );
  }

  const live = sources.find((source) => source.source === 'live_run');
  if (!live || live.stances === 0) {
    warnings.push(
      `No scored swarm runs contributed forecasting rows, so the ${AGENT_NAMES.semantic} may be ungraded on Brier. Trading fitness still comes from paper replay of quantitative agents.`,
    );
  }

  const flat = flatPriceShare(stances);
  if (flat !== null && flat > FLAT_PRICE_SHARE) {
    warnings.push(
      `${(flat * 100).toFixed(0)}% of forecasting stances were on markets showing no usable quote (50/50 fallback). Collect while markets are open.`,
    );
  }

  const depth = depthShare(stances);
  if (depth !== null && depth < LOW_DEPTH_SHARE && stances.length > 0) {
    warnings.push(
      `Only ${(depth * 100).toFixed(0)}% of forecasting stances had a stored order book, so depth-driven inputs were mostly zero.`,
    );
  }

  const lopsided = lopsidedShare(stances);
  if (lopsided !== null && lopsided > LOPSIDED_SHARE) {
    warnings.push(
      `${(lopsided * 100).toFixed(0)}% of forecasting stances were on markets already priced beyond 80/20.`,
    );
  }

  const imbalance = outcomeBalanceWarning(stances);
  if (imbalance) {
    warnings.push(imbalance);
  }

  if (swarm.trades < options.minSampleForWeight) {
    warnings.push(
      `Fewer than ${options.minSampleForWeight} coherent swarm trades, so suggested weights may stay pinned at 1.0.`,
    );
  }

  return warnings;
}

function agentWarnings(agents: AgentFitness[]): string[] {
  const warnings: string[] = [];

  for (const agent of agents) {
    const { overconfidence, accuracy, meanConfidence } = agent.forecasting;
    if (
      overconfidence !== null &&
      overconfidence > OVERCONFIDENCE_LIMIT &&
      accuracy !== null &&
      meanConfidence !== null
    ) {
      warnings.push(
        `${agent.agent} states an average confidence of ${(meanConfidence * 100).toFixed(0)}% but its secondary stance grades were profitable ${(accuracy * 100).toFixed(0)}% of the time.`,
      );
    }

    if (agent.trading.trades === 0 && agent.forecasting.directional === 0 && agent.forecasting.stances > 0) {
      warnings.push(
        `${agent.agent} never took a side across ${agent.forecasting.stances} forecasting stances and closed no paper trades.`,
      );
    }
  }

  return warnings;
}

export function buildWarnings(
  stances: GradedStance[],
  agents: AgentFitness[],
  sources: SourceSummary[],
  options: FitnessOptions,
  swarm: TradingPerformance,
): string[] {
  return [...sampleWarnings(stances, sources, options, swarm), ...agentWarnings(agents)];
}
