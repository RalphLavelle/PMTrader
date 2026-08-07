import type { BacktestOptions, CalibrationBucket, SkippedMarket } from '../backtest/index.js';
import type { AgentName, Stance } from '../schemas/index.js';

/**
 * Phase 5 agent fitness types.
 *
 * Phase 4 graded the swarm's *blended* recommendation and found that the blend
 * nearly always holds, which makes it a poor thing to measure. Every specialist
 * still took a side at every decision point though, and those stances can be
 * graded whether or not the Risk Manager acted on them. That is what fitness
 * measures: not "did we trade well?" but "which specialist deserves trust, and
 * under what conditions?".
 *
 * Nothing here is persisted. Like the Phase 2 features and the Phase 4
 * backtest, a fitness report is a derived view — recompute it rather than
 * migrate it.
 */

/**
 * Where a graded stance came from.
 *
 * The two sources answer different questions and must never be silently mixed
 * into one number without saying so:
 *
 * - `backtest` — stances replayed from collected history. Deterministic and
 *   plentiful, but the semantic agent cannot be replayed, so it is absent.
 * - `live_run` — stances the real swarm produced, read back from stored runs
 *   the labeller has since scored. The only evidence that can grade the
 *   semantic agent, but there are far fewer of them.
 */
export type FitnessSource = 'backtest' | 'live_run';

/** Knobs for one fitness report. */
export interface FitnessOptions {
  /** Replay settings handed straight to the Phase 4 engine. */
  backtest: BacktestOptions;
  /** Read stored swarm runs too — the only way the semantic agent gets graded. */
  includeLiveRuns: boolean;
  /** Most stored runs to examine. MongoDB only, so this is cheap. */
  maxRuns: number;
  /**
   * Fewest graded stances before a suggested weight is anything but neutral.
   *
   * With a handful of samples an "accuracy" is mostly noise, and Phase 6 acting
   * on noise would be worse than Phase 6 doing nothing.
   */
  minSampleForWeight: number;
}

/**
 * One specialist's opinion at one moment, with the answer attached.
 *
 * This is the atom of Phase 5. A stance is treated as a *probabilistic
 * forecast* rather than a yes/no call, because "70% confident YES" and "100%
 * confident YES" are very different claims that a plain accuracy count would
 * score identically.
 */
export interface GradedStance {
  agent: AgentName;
  source: FitnessSource;
  marketId: string;
  decidedAt: string;
  stance: Stance;
  confidence: number;
  /** P(YES) the stance implies, using the Risk Manager's own mapping. */
  predictedYes: number;
  /** P(YES) the market itself showed at that moment — the forecaster to beat. */
  marketYes: number;
  resolvedTo: 'yes' | 'no';
  liquidityScore: number;
  hoursToClose: number | null;
  /** False when depth was never captured, so depth-driven signals were blind. */
  hadOrderbook: boolean;
}

/** How well a set of stances did. */
export interface StanceStats {
  stances: number;
  /** Stances that actually took a side; neutral ones abstained. */
  directional: number;
  neutral: number;
  correct: number;
  incorrect: number;
  /** correct / (correct + incorrect). Null when the agent never took a side. */
  accuracy: number | null;
  meanConfidence: number | null;
  /**
   * Mean Brier score — the squared error of the stated probability.
   *
   * Lower is better. Always saying "50/50" scores 0.25, so anything above that
   * is worse than admitting you do not know.
   */
  brierScore: number | null;
  /** The same score for the market price at the same moments. */
  marketBrierScore: number | null;
  /**
   * `1 − brier / marketBrier`. Above zero means the agent knew something the
   * price did not; below zero means reading the price would have been better.
   */
  skillVsMarket: number | null;
  /**
   * `meanConfidence − accuracy`. Positive means the agent claims more certainty
   * than it delivers, which is exactly what Phase 6 must discount.
   */
  overconfidence: number | null;
}

/** Which slice of market conditions a set of stances was taken in. */
export type RegimeDimension =
  | 'liquidity'
  | 'time_to_close'
  | 'market_conviction'
  | 'orderbook';

/** One specialist's record inside one slice of conditions. */
export interface RegimeFitness {
  dimension: RegimeDimension;
  bucket: string;
  /** Plain-English reminder of what the bucket boundary actually is. */
  description: string;
  stats: StanceStats;
}

/**
 * What Phase 6 would multiply a specialist's confidence by.
 *
 * Deliberately *suggested*, not applied. Phase 5 measures; Phase 6 decides
 * whether to act, and keeping those apart means a surprising weight can be read
 * and argued with before it changes any recommendation.
 */
export interface SuggestedWeight {
  /** 1.0 means "trust as-is". Above 1 earns influence, below 1 loses it. */
  weight: number;
  /** False when the sample is too small for the number to mean anything. */
  reliable: boolean;
  sampleSize: number;
  /** Why the number came out where it did, in one sentence. */
  rationale: string;
}

/** Everything Phase 5 knows about one specialist. */
export interface AgentFitness {
  agent: AgentName;
  overall: StanceStats;
  /** Split by evidence source, because replayed and live stances differ in kind. */
  bySource: Array<{ source: FitnessSource; stats: StanceStats }>;
  calibration: CalibrationBucket[];
  regimes: RegimeFitness[];
  weight: SuggestedWeight;
}

/**
 * How two specialists fared against each other.
 *
 * Phase 4's headline finding was that trend and mean reversion cancel out, so
 * the blend almost never trades. That makes "when these two disagreed, which
 * one was right?" the single most actionable question in Phase 5 — it is what
 * tells Phase 6 whether the disagreement penalty should stay symmetric.
 */
export interface HeadToHead {
  agentA: AgentName;
  agentB: AgentName;
  /** Decision points where both took a side, so a comparison was possible. */
  comparisons: number;
  agreements: number;
  disagreements: number;
  /** Of the disagreements, how often each one turned out to be the right side. */
  agentAWins: number;
  agentBWins: number;
  /** Accuracy when they agreed — is consensus actually worth more than one view? */
  agreementAccuracy: number | null;
}

/** How much evidence one source contributed. */
export interface SourceSummary {
  source: FitnessSource;
  stances: number;
  markets: number;
  agents: AgentName[];
  /** What a reader should keep in mind about this source's coverage. */
  note: string;
}

/** Everything one fitness pass produced. */
export interface FitnessReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  options: FitnessOptions;
  sources: SourceSummary[];
  gradedStances: number;
  marketsCovered: number;
  agents: AgentFitness[];
  headToHead: HeadToHead[];
  /** Markets the replay could not use, carried through from Phase 4. */
  skipped: SkippedMarket[];
  /** Caveats a reader must see before believing any number above. */
  warnings: string[];
}
