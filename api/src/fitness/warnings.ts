import { AGENT_NAMES } from '../agents/names.js';
import type {
  AgentFitness,
  FitnessOptions,
  GradedStance,
  SourceSummary,
} from './types.js';

/**
 * The caveats that stop a fitness report being read as more than it is.
 *
 * Every number in Phase 5 is a ratio, and a ratio over a small or skewed sample
 * is dangerously easy to over-trust. These warnings exist so a reader is told
 * what is wrong with the sample *before* they act on a weight — the alternative
 * is a confident-looking table that quietly encodes a handful of lucky guesses.
 *
 * Pure functions: they read the report and return prose, nothing else.
 */

/** Below this share of stances backed by depth, imbalance signals were mostly blind. */
const LOW_DEPTH_SHARE = 0.5;

/** Above this, an agent is claiming far more certainty than it delivers. */
const OVERCONFIDENCE_LIMIT = 0.15;

/** Warn when almost every stance came from a market already priced lopsidedly. */
const LOPSIDED_SHARE = 0.8;

/** How one-sided the answer key may get before accuracy stops meaning anything. */
const OUTCOME_BALANCE_LIMIT = 0.8;

/** Below this spread of market prices, the quotes carried no information at all. */
const FLAT_PRICE_SHARE = 0.9;

/**
 * The share of stances taken when the market price was the 0.5 fallback.
 *
 * `deriveFeatures` falls back to an even 50/50 when a market has no usable
 * quote, which is exactly what a market first collected *after* it stopped
 * trading looks like. Those rows are not evidence about anything: the agents
 * see nothing, the market benchmark sees nothing, and every score collapses to
 * the same uninformative value.
 */
function flatPriceShare(stances: GradedStance[]): number | null {
  if (stances.length === 0) {
    return null;
  }
  const flat = stances.filter((stance) => Math.abs(stance.marketYes - 0.5) < 1e-6).length;
  return flat / stances.length;
}

/** The share of stances that had a stored order book behind them. */
function depthShare(stances: GradedStance[]): number | null {
  if (stances.length === 0) {
    return null;
  }
  return stances.filter((stance) => stance.hadOrderbook).length / stances.length;
}

/** The share of stances taken on markets already more than 80/20. */
function lopsidedShare(stances: GradedStance[]): number | null {
  if (stances.length === 0) {
    return null;
  }
  const lopsided = stances.filter(
    (stance) => Math.abs(stance.marketYes - 0.5) > 0.3,
  ).length;
  return lopsided / stances.length;
}

/** The share of stances whose market resolved YES. */
function yesShare(stances: GradedStance[]): number | null {
  if (stances.length === 0) {
    return null;
  }
  return stances.filter((stance) => stance.resolvedTo === 'yes').length / stances.length;
}

/**
 * Warn when the answer key is nearly all one side.
 *
 * If 95% of the graded markets resolved NO, an agent that says NO to everything
 * scores 95% accuracy while knowing nothing whatsoever. This is the classic
 * class-imbalance trap, and it is easy to fall into early on because the first
 * markets to settle are rarely a representative sample.
 */
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
  return `${(majority * 100).toFixed(0)}% of graded markets resolved ${side}. An agent that always said ${side} would score that accuracy while knowing nothing, so compare against skill vs market rather than accuracy until the sample balances out.`;
}

/** Caveats about how much evidence exists and where it came from. */
function sampleWarnings(
  stances: GradedStance[],
  sources: SourceSummary[],
  options: FitnessOptions,
): string[] {
  const warnings: string[] = [];

  if (stances.length === 0) {
    warnings.push(
      'No stances could be graded. Markets must be watched by the collector while open and then resolved by the labeller before fitness has anything to measure.',
    );
    return warnings;
  }

  const live = sources.find((source) => source.source === 'live_run');
  if (!live || live.stances === 0) {
    warnings.push(
      `No scored swarm runs contributed, so the ${AGENT_NAMES.semantic} is ungraded. It is the agent supplying most of the swarm's directional opinion, which makes it the largest blind spot in this report.`,
    );
  }

  const flat = flatPriceShare(stances);
  if (flat !== null && flat > FLAT_PRICE_SHARE) {
    warnings.push(
      `${(flat * 100).toFixed(0)}% of stances were taken on markets showing no usable quote, so the price defaulted to an even 50/50. The agents had nothing to read and neither did the benchmark, which is why skill lands on zero. These markets were collected only after they stopped trading; the fix is coverage while open, not tuning.`,
    );
  }

  const depth = depthShare(stances);
  if (depth !== null && depth < LOW_DEPTH_SHARE) {
    warnings.push(
      `Only ${(depth * 100).toFixed(0)}% of stances had a stored order book behind them, so depth-driven inputs were mostly zero. Widen the collector's orderbook watchlist before trusting any liquidity regime.`,
    );
  }

  const lopsided = lopsidedShare(stances);
  if (lopsided !== null && lopsided > LOPSIDED_SHARE) {
    warnings.push(
      `${(lopsided * 100).toFixed(0)}% of stances were taken on markets already priced beyond 80/20, where following the favourite is nearly free. Accuracy will look high for reasons that have nothing to do with skill.`,
    );
  }

  const imbalance = outcomeBalanceWarning(stances);
  if (imbalance) {
    warnings.push(imbalance);
  }

  const unreliable = options.minSampleForWeight;
  if (stances.length < unreliable) {
    warnings.push(
      `The whole dataset holds fewer than ${unreliable} stances, so every suggested weight is pinned at 1.0 and no specialist can yet be preferred over another.`,
    );
  }

  return warnings;
}

/** Caveats about what individual agents' numbers reveal. */
function agentWarnings(agents: AgentFitness[]): string[] {
  const warnings: string[] = [];

  for (const agent of agents) {
    const { overconfidence, accuracy, meanConfidence } = agent.overall;
    if (
      overconfidence !== null &&
      overconfidence > OVERCONFIDENCE_LIMIT &&
      accuracy !== null &&
      meanConfidence !== null
    ) {
      warnings.push(
        `${agent.agent} states an average confidence of ${(meanConfidence * 100).toFixed(0)}% but is right ${(accuracy * 100).toFixed(0)}% of the time. Its confidence should be discounted, not just its direction.`,
      );
    }

    if (agent.overall.directional === 0 && agent.overall.stances > 0) {
      warnings.push(
        `${agent.agent} never took a side across ${agent.overall.stances} stances, so it can only be graded on how good "no opinion" was.`,
      );
    }
  }

  return warnings;
}

/** Every caveat a reader needs before believing the report. */
export function buildWarnings(
  stances: GradedStance[],
  agents: AgentFitness[],
  sources: SourceSummary[],
  options: FitnessOptions,
): string[] {
  return [...sampleWarnings(stances, sources, options), ...agentWarnings(agents)];
}
