import { z } from 'zod';
import { isoTimestampSchema } from './common.js';

/**
 * Market data contracts.
 *
 * A `MarketSnapshot` is a normalised, agent-friendly view of a Jupiter market.
 * Raw Jupiter responses stay in `src/jupiter/types.ts`; converting to a
 * snapshot at the boundary means agents never depend on the upstream API shape.
 */

/** One side of the orderbook condensed into the numbers agents actually use. */
export const orderbookDepthSchema = z.object({
  levels: z.number().int().min(0).describe('Number of price levels quoted'),
  totalQuantity: z.number().min(0).describe('Sum of quantity across all levels'),
  bestPriceUsd: z
    .number()
    .nullable()
    .describe('Best (highest) bid price in USD, or null when the book is empty'),
});

/** Normalised market state captured at a single point in time. */
export const marketSnapshotSchema = z.object({
  marketId: z.string().min(1),
  title: z.string(),
  status: z.string().describe('Jupiter market status, e.g. "open" or "closed"'),
  buyYesPriceUsd: z.number().min(0).max(1),
  buyNoPriceUsd: z.number().min(0).max(1),
  sellYesPriceUsd: z.number().min(0).max(1),
  sellNoPriceUsd: z.number().min(0).max(1),
  volumeUsd: z.number().min(0),
  yesDepth: orderbookDepthSchema,
  noDepth: orderbookDepthSchema,
  rulesPrimary: z.string().nullable(),
  rulesSecondary: z.string().nullable(),
  closeTime: z.number().int().nullable().describe('Unix seconds when the market closes'),
  capturedAt: isoTimestampSchema,
});

/**
 * Quantitative features derived from a snapshot by the Market Analyst.
 *
 * Keeping these separate from the snapshot makes the provenance obvious:
 * snapshot fields come from Jupiter, feature fields are computed by us.
 */
export const derivedFeaturesSchema = z.object({
  impliedYesProbability: z
    .number()
    .min(0)
    .max(1)
    .describe('Yes price normalised against the yes+no total'),
  spreadUsd: z
    .number()
    .min(0)
    .describe('Gap between the buy and sell price for the yes side'),
  depthImbalance: z
    .number()
    .min(-1)
    .max(1)
    .describe('Positive when yes-side depth dominates, negative when no-side does'),
  totalDepth: z.number().min(0).describe('Combined quantity resting on both sides'),
  liquidityScore: z
    .number()
    .min(0)
    .max(1)
    .describe('Normalised 0..1 view of how tradeable the market currently is'),
  priceExtremity: z
    .number()
    .min(0)
    .max(1)
    .describe('How far the implied probability sits from 0.5 (0 = balanced, 1 = certain)'),
  hoursToClose: z
    .number()
    .nullable()
    .describe('Hours remaining before the market closes, or null when unknown'),
});

export type OrderbookDepth = z.infer<typeof orderbookDepthSchema>;
export type MarketSnapshot = z.infer<typeof marketSnapshotSchema>;
export type DerivedFeatures = z.infer<typeof derivedFeaturesSchema>;
