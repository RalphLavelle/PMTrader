import { Router } from 'express';
import { z } from 'zod';
import { analysisMemory } from '../memory/index.js';
import { tradeOutcomeSchema, type AnalysisRecord } from '../schemas/index.js';
import { runSwarmAnalysis } from '../swarm/index.js';
import { parseOptionalInt } from './jupiter-error.js';

export const swarmRouter = Router();

/** Body accepted when recording how a market actually resolved. */
const outcomeInputSchema = z.object({
  resolved: z.boolean(),
  resolvedTo: z.enum(['yes', 'no']).nullable().default(null),
  realizedPnlUsd: z.number().nullable().default(null),
  /** Omit to have the server derive it from the stored recommendation. */
  wasCorrect: z.boolean().nullable().default(null),
});

/**
 * Run the multi-agent swarm over a market.
 *
 * Pass `?deterministic=true` to bypass the LLM and run the same business logic
 * in a fixed order — useful for comparing the two paths on identical data.
 */
swarmRouter.post('/analysis/:marketId', async (req, res) => {
  const marketId = req.params['marketId'];
  if (!marketId) {
    res.status(400).json({ error: 'marketId is required' });
    return;
  }

  try {
    const result = await runSwarmAnalysis({
      marketId,
      deterministic: req.query['deterministic'] === 'true',
    });
    res.json(result);
  } catch (error) {
    console.error('[swarm] Analysis failed:', error);
    const message = error instanceof Error ? error.message : 'Swarm analysis failed.';
    res.status(500).json({ error: message });
  }
});

/** List stored analyses, newest first, optionally filtered by market. */
swarmRouter.get('/analyses', async (req, res) => {
  const marketId = typeof req.query['marketId'] === 'string' ? req.query['marketId'] : undefined;
  const limit = parseOptionalInt(req.query['limit']);

  try {
    const runs = await analysisMemory.list({
      ...(marketId ? { marketId } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    res.json({ driver: analysisMemory.driver, count: runs.length, data: runs.map((run) => run.record) });
  } catch (error) {
    console.error('[swarm] Failed to list analyses:', error);
    res.status(500).json({ error: 'Failed to read analysis memory.' });
  }
});

/** Fetch a single stored analysis by id. */
swarmRouter.get('/analyses/:id', async (req, res) => {
  const id = req.params['id'];
  if (!id) {
    res.status(400).json({ error: 'id is required' });
    return;
  }

  try {
    const run = await analysisMemory.findById(id);
    if (!run) {
      res.status(404).json({ error: `No analysis found with id ${id}` });
      return;
    }
    res.json(run.record);
  } catch (error) {
    console.error('[swarm] Failed to read analysis:', error);
    res.status(500).json({ error: 'Failed to read analysis memory.' });
  }
});

/**
 * Attach a resolution outcome to a stored analysis.
 *
 * This closes the feedback loop: once a market settles, recording what happened
 * turns a prediction into training data a future Learning Agent can score.
 */
swarmRouter.patch('/analyses/:id/outcome', async (req, res) => {
  const id = req.params['id'];
  if (!id) {
    res.status(400).json({ error: 'id is required' });
    return;
  }

  const parsed = outcomeInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid outcome payload', details: parsed.error.issues });
    return;
  }

  try {
    const existing = await analysisMemory.findById(id);
    if (!existing) {
      res.status(404).json({ error: `No analysis found with id ${id}` });
      return;
    }

    const outcome = tradeOutcomeSchema.parse({
      ...parsed.data,
      wasCorrect: parsed.data.wasCorrect ?? deriveWasCorrect(existing.record, parsed.data.resolvedTo),
      recordedAt: new Date().toISOString(),
    });

    const updated = await analysisMemory.recordOutcome(id, outcome);
    res.json(updated?.record ?? null);
  } catch (error) {
    console.error('[swarm] Failed to record outcome:', error);
    res.status(500).json({ error: 'Failed to record outcome.' });
  }
});

/**
 * Score a stored recommendation against the actual resolution.
 *
 * Returns null when the market has not resolved or the swarm advised holding —
 * neither case says anything about whether the swarm was right.
 */
function deriveWasCorrect(
  record: AnalysisRecord,
  resolvedTo: 'yes' | 'no' | null,
): boolean | null {
  if (resolvedTo === null) {
    return null;
  }

  const { recommendation } = record.recommendation;
  if (recommendation === 'hold') {
    return null;
  }

  return recommendation === (resolvedTo === 'yes' ? 'buy_yes' : 'buy_no');
}
