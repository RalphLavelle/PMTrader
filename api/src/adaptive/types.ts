import type { AgentName } from '../schemas/index.js';
import type { CompletedFitnessTrade, RegimeDimension } from '../fitness/types.js';

/**
 * Phase 6 adaptive weighting contracts.
 *
 * Fitness measures; this layer decides how much each specialist's voice
 * counts in aggregation — conservatively, from coherent paper trades only.
 */

/** Baseline influence when evidence is thin or missing. */
export const BASELINE_WEIGHT = 1;

/** Hard clamps so no agent can vanish or dominate. */
export const WEIGHT_FLOOR = 0.25;
export const WEIGHT_CEILING = 1.5;

/** Knobs for the adaptive score → weight transform. */
export interface AdaptiveOptions {
  /** Fewest trades before a weight may leave the baseline. */
  minSample: number;
  /** How many most-recent trades define "recent" fitness. */
  recentWindow: number;
  /**
   * How strongly a ±1 fitness score moves the weight away from baseline.
   * Keep small so adaptation is gradual (0.4 → weights in ~0.6..1.4 before clamp).
   */
  sensitivity: number;
  /**
   * Blend toward the previous published weight (0 = jump, 1 = freeze).
   * Smooths abrupt switching across fitness passes.
   */
  inertia: number;
  /** Pseudocounts added to wins and losses so one trade cannot swing win rate. */
  winRatePrior: number;
}

/** Market conditions used to ask "how did this agent do when it looked like this?". */
export interface RegimeContext {
  liquidityScore: number;
  hoursToClose: number | null;
  /** Implied P(YES) from the live quote. */
  marketYes: number;
  hadOrderbook: boolean;
}

export interface RegimeWeightSlice {
  dimension: RegimeDimension;
  bucket: string;
  sampleCount: number;
  fitness: number;
  realisedPnlUsd: number;
}

export type EvidenceLevel = 'none' | 'low' | 'moderate' | 'high';

/**
 * Inspectable evidence behind one agent's current weight.
 *
 * This is what GET /api/fitness/weights returns so a human can challenge a number.
 */
export interface AdaptiveAgentWeight {
  agent: AgentName;
  /** Weight applied in aggregation right now. */
  currentWeight: number;
  baselineWeight: number;
  sampleCount: number;
  recentSampleCount: number;
  recentPnlUsd: number;
  longTermPnlUsd: number;
  drawdownUsd: number;
  /** Regime slice used for the regime-conditioned blend, if any. */
  regime: RegimeWeightSlice | null;
  evidenceLevel: EvidenceLevel;
  /** Composite scores in roughly [-1, +1]. */
  overallFitness: number;
  recentFitness: number;
  /** Fitness after confidence-calibration adjustment. */
  confidenceAdjustedFitness: number;
  consistency: number;
  /** Effective score after overall/recent/regime blend and penalties. */
  effectiveFitness: number;
  rationale: string;
}

export interface AdaptiveWeightTable {
  computedAt: string;
  options: AdaptiveOptions;
  baselineWeight: number;
  agents: AdaptiveAgentWeight[];
  /** Source fitness report timestamp, when built from a report. */
  sourceFitnessAt: string | null;
  warnings: string[];
}

/** Optional map handed to aggregateSignals. Missing agents → baseline. */
export type AgentWeightMap = Partial<Record<AgentName, number>>;

/** Trades plus optional prior weight for inertia. */
export interface AdaptiveBuildInput {
  tradesByAgent: Map<AgentName, CompletedFitnessTrade[]>;
  previous?: AdaptiveWeightTable | null;
  options?: Partial<AdaptiveOptions>;
  /** When set, each agent's weight blends in that regime's fitness. */
  regimeContext?: RegimeContext | null;
}
