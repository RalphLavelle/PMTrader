/** Types for the Phase 5 agent fitness dashboard — mirror /api/fitness responses. */

import { CalibrationBucket } from './backtest.model';

/** Where a graded stance came from; the two sources cover different agents. */
export type FitnessSource = 'backtest' | 'live_run';

/** How well one set of stances did. */
export interface StanceStats {
  stances: number;
  directional: number;
  neutral: number;
  correct: number;
  incorrect: number;
  accuracy: number | null;
  meanConfidence: number | null;
  /** Squared error of the stated probability; 0.25 means "always said 50/50". */
  brierScore: number | null;
  marketBrierScore: number | null;
  /** Above zero means the agent knew something the market price did not. */
  skillVsMarket: number | null;
  /** Stated confidence minus delivered accuracy. */
  overconfidence: number | null;
}

/** One specialist's record inside one slice of market conditions. */
export interface RegimeFitness {
  dimension: 'liquidity' | 'time_to_close' | 'market_conviction' | 'orderbook';
  bucket: string;
  description: string;
  stats: StanceStats;
}

/** What Phase 6 would multiply this specialist's confidence by. */
export interface SuggestedWeight {
  weight: number;
  reliable: boolean;
  sampleSize: number;
  rationale: string;
}

export interface AgentFitness {
  agent: string;
  overall: StanceStats;
  bySource: Array<{ source: FitnessSource; stats: StanceStats }>;
  calibration: CalibrationBucket[];
  regimes: RegimeFitness[];
  weight: SuggestedWeight;
}

/** Who was right when two specialists took opposite sides. */
export interface HeadToHead {
  agentA: string;
  agentB: string;
  comparisons: number;
  agreements: number;
  disagreements: number;
  agentAWins: number;
  agentBWins: number;
  agreementAccuracy: number | null;
}

export interface SourceSummary {
  source: FitnessSource;
  stances: number;
  markets: number;
  agents: string[];
  note: string;
}

export interface FitnessOptions {
  includeLiveRuns: boolean;
  maxRuns: number;
  minSampleForWeight: number;
  backtest: {
    maxMarkets: number;
    decisionIntervalMinutes: number;
    minSnapshots: number;
    maxSnapshotsPerMarket: number;
    requireOrderbook: boolean;
    minConfidence: number;
  };
}

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
  skipped: Array<{ marketId: string; reason: string }>;
  /** Caveats to read before believing anything above them. */
  warnings: string[];
}

export interface FitnessStatus {
  running: boolean;
  defaults: FitnessOptions;
  resolvedMarkets: number;
  labelledMarkets: number;
  lastRun: FitnessReport | null;
}
