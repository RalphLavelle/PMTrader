import { z } from 'zod';
import {
  confidenceSchema,
  isoTimestampSchema,
  recommendationSchema,
} from './common.js';

/**
 * Risk contracts.
 *
 * The Risk Manager is the only agent allowed to approve or veto a trade, so its
 * output carries both the decision and the sizing that follows from it.
 */
export const riskAssessmentSchema = z.object({
  approved: z.boolean().describe('False when the Risk Manager vetoes the trade'),
  /** Populated only when `approved` is false — explains the veto in plain terms. */
  vetoReasons: z.array(z.string()).default([]),
  /** Warnings that did not rise to a veto but should be surfaced to the operator. */
  warnings: z.array(z.string()).default([]),
  positionSizeUsd: z
    .number()
    .min(0)
    .describe('Recommended stake in USD; 0 whenever the trade is vetoed'),
  maxPositionUsd: z.number().min(0).describe('Ceiling applied during sizing'),
  riskScore: z
    .number()
    .min(0)
    .max(1)
    .describe('0 = negligible risk, 1 = maximum risk'),
  assessedAt: isoTimestampSchema,
});

/** The swarm's final, risk-adjusted answer for a single market. */
export const swarmRecommendationSchema = z.object({
  marketId: z.string().min(1),
  recommendation: recommendationSchema,
  yesLikelihood: confidenceSchema,
  confidence: confidenceSchema,
  positionSizeUsd: z.number().min(0),
  rationale: z.string().min(1),
  decidedAt: isoTimestampSchema,
});

export type RiskAssessment = z.infer<typeof riskAssessmentSchema>;
export type SwarmRecommendation = z.infer<typeof swarmRecommendationSchema>;
