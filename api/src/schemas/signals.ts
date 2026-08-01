import { z } from 'zod';
import {
  agentNameSchema,
  confidenceSchema,
  isoTimestampSchema,
  recommendationSchema,
  stanceSchema,
} from './common.js';

/**
 * Signal contracts.
 *
 * Every specialist agent (trend, mean reversion, semantic) returns the same
 * `AgentSignal` shape. A uniform contract is what lets the Risk Manager — and
 * any future agent such as a Portfolio Manager — consume opinions without
 * knowing which strategy produced them.
 */
export const agentSignalSchema = z.object({
  agent: agentNameSchema.describe('Which specialist produced this signal'),
  stance: stanceSchema,
  confidence: confidenceSchema,
  reasoning: z.string().min(1).describe('Short human-readable justification'),
  /** Named numeric inputs behind the verdict, kept for auditing and future learning. */
  supportingMetrics: z.record(z.string(), z.number()).default({}),
  generatedAt: isoTimestampSchema,
});

/** A trade the swarm proposes before the Risk Manager has reviewed it. */
export const proposedTradeSchema = z.object({
  marketId: z.string().min(1),
  recommendation: recommendationSchema,
  /** Blended probability that the market resolves YES, across all signals. */
  yesLikelihood: confidenceSchema,
  /** How strongly the contributing agents agreed. */
  confidence: confidenceSchema,
  contributingAgents: z.array(agentNameSchema).min(1),
});

export type AgentSignal = z.infer<typeof agentSignalSchema>;
export type ProposedTrade = z.infer<typeof proposedTradeSchema>;
