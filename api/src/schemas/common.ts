import { z } from 'zod';

/**
 * Shared primitive schemas used across every agent contract.
 *
 * Zod is the TypeScript equivalent of Python's Pydantic: it validates data at
 * runtime *and* produces a static type via `z.infer`, so a single declaration
 * keeps the compiler and the running program in agreement.
 */

/** A probability-style score constrained to the inclusive range 0..1. */
export const confidenceSchema = z
  .number()
  .min(0)
  .max(1)
  .describe('Confidence between 0 (no conviction) and 1 (maximum conviction)');

/** Which side of a binary prediction market an agent favours. */
export const stanceSchema = z
  .enum(['yes', 'no', 'neutral'])
  .describe('Directional view: yes, no, or neutral when no edge is present');

/** The action the swarm recommends after every specialist has weighed in. */
export const recommendationSchema = z
  .enum(['buy_yes', 'buy_no', 'hold'])
  .describe('Final trade recommendation produced by the swarm');

/** ISO-8601 timestamp string, e.g. "2026-08-01T11:22:33.000Z". */
export const isoTimestampSchema = z
  .string()
  .describe('ISO-8601 timestamp recording when a value was produced');

/**
 * Canonical names for every agent in the swarm.
 *
 * These strings are used verbatim as LangGraph node names, so they are kept in
 * `snake_case`: the swarm's `createHandoffTool` lowercases and underscores the
 * agent name when building its tool name, and matching the two forms avoids a
 * confusing mismatch between node names and tool names.
 */
export const agentNameSchema = z.enum([
  'market_analyst',
  'trend_agent',
  'mean_reversion_agent',
  'semantic_agent',
  'risk_manager',
]);

export type Confidence = z.infer<typeof confidenceSchema>;
export type Stance = z.infer<typeof stanceSchema>;
export type Recommendation = z.infer<typeof recommendationSchema>;
export type AgentName = z.infer<typeof agentNameSchema>;
