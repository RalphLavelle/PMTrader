import { z } from 'zod';
import { agentNameSchema, confidenceSchema, isoTimestampSchema } from './common.js';
import { derivedFeaturesSchema, marketSnapshotSchema } from './market.js';
import { agentSignalSchema } from './signals.js';
import { riskAssessmentSchema, swarmRecommendationSchema } from './risk.js';

/**
 * Analysis + memory contracts.
 *
 * `AnalysisRecord` is the unit of long-term memory: one completed swarm run,
 * stored so later runs (and a future Learning Agent) can compare what the swarm
 * predicted against what actually happened.
 */

/**
 * How a past recommendation performed, recorded after the fact.
 *
 * Primary scoreboard is intramarket: enter while open, exit later at a mark
 * price. Final resolution (`resolvedTo` / `wasCorrect`) is secondary context —
 * useful for calibration, not the definition of a successful trade.
 */
export const tradeOutcomeSchema = z.object({
  resolved: z.boolean().describe('True once the market has settled'),
  resolvedTo: z
    .enum(['yes', 'no'])
    .nullable()
    .describe('Which side won, or null when still unresolved'),
  /**
   * How `realizedPnlUsd` was computed.
   * - intramarket: entry → later exit quote (primary)
   * - resolution: hold-to-settlement at $1/$0 (legacy / secondary)
   */
  scoringMode: z
    .enum(['intramarket', 'resolution'])
    .default('resolution')
    .describe('Which PnL model produced realizedPnlUsd'),
  entryPriceUsd: z.number().nullable().optional(),
  exitPriceUsd: z.number().nullable().optional(),
  exitAt: isoTimestampSchema.nullable().optional(),
  holdMinutes: z.number().nullable().optional(),
  realizedPnlUsd: z
    .number()
    .nullable()
    .describe('Profit or loss in USD if the recommendation was acted on'),
  /**
   * True when the recommendation matched the eventual resolution.
   * Secondary learning signal — not the primary trading objective.
   */
  wasCorrect: z.boolean().nullable(),
  /** True when intramarket (or resolution) PnL was positive. */
  wasProfitable: z.boolean().nullable().optional(),
  recordedAt: isoTimestampSchema,
});

/**
 * A completed swarm analysis, persisted to memory.
 *
 * The task brief requires timestamp, market id, participating agents, individual
 * confidence scores, final recommendation, and an optional trade outcome; each
 * of those maps to a field below.
 */
export const analysisRecordSchema = z.object({
  id: z.string().min(1).describe('Stable unique id for this analysis run'),
  timestamp: isoTimestampSchema,
  marketId: z.string().min(1),
  participatingAgents: z.array(agentNameSchema),
  /**
   * Per-agent confidence, keyed by agent name, for quick scoring and comparison.
   *
   * `partialRecord` is used because not every agent participates in every run —
   * a plain `record` over an enum would demand all five keys be present.
   */
  confidenceScores: z.partialRecord(agentNameSchema, confidenceSchema),
  signals: z.array(agentSignalSchema),
  riskAssessment: riskAssessmentSchema.nullable(),
  recommendation: swarmRecommendationSchema,
  /** Optional today; filled once an exit (or resolution) can be scored. */
  outcome: tradeOutcomeSchema.nullable().default(null),
  /** How the run executed, useful when comparing LLM and deterministic results. */
  mode: z.enum(['swarm', 'deterministic']),
});

/** Everything a single run produces, returned to API callers. */
export const swarmAnalysisResultSchema = z.object({
  record: analysisRecordSchema,
  snapshot: marketSnapshotSchema,
  features: derivedFeaturesSchema,
});

export type TradeOutcome = z.infer<typeof tradeOutcomeSchema>;
export type AnalysisRecord = z.infer<typeof analysisRecordSchema>;
export type SwarmAnalysisResult = z.infer<typeof swarmAnalysisResultSchema>;
