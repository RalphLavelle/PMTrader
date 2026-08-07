import { Router } from 'express';
import { config } from '../config.js';
import {
  countResolvedMarkets,
  findLabelCandidates,
  getLastLabellerPass,
  isLabellerPassRunning,
  runLabellerPass,
} from '../labeller/index.js';
import { analysisMemory } from '../memory/index.js';
import { connectMongo } from '../memory/mongodb.client.js';
import { parseOptionalInt } from './jupiter-error.js';

export const labellerRouter = Router();

/**
 * Phase 3 outcome labeller endpoints.
 *
 * The labeller normally runs on its own timer, so these routes exist for
 * visibility and for kicking a pass by hand — useful when a market you care
 * about has just settled and you would rather not wait for the interval.
 */

/** Labeller health: config, last pass, and how much work is outstanding. */
labellerRouter.get('/status', async (req, res) => {
  try {
    await connectMongo();
    const candidateLimit = parseOptionalInt(req.query['candidates']) ?? 10;

    const [candidates, resolvedMarkets, pendingRuns] = await Promise.all([
      findLabelCandidates(),
      countResolvedMarkets(),
      analysisMemory.listPendingOutcomes(500),
    ]);

    res.json({
      enabled: config.labellerEnabled,
      running: isLabellerPassRunning(),
      intervalMs: config.labellerIntervalMs,
      marketBatchSize: config.labellerMarketBatchSize,
      runBatchSize: config.labellerRunBatchSize,
      resolvedMarkets,
      pendingCandidates: candidates.length,
      pendingRuns: pendingRuns.length,
      /** A preview of what the next pass would look at. */
      nextCandidates: candidates.slice(0, Math.min(Math.max(candidateLimit, 1), 100)),
      lastPass: getLastLabellerPass(),
    });
  } catch (error) {
    console.error('[labeller] status failed:', error);
    res.status(500).json({ error: 'Failed to read labeller status.' });
  }
});

/** Run one labelling pass immediately and return what it did. */
labellerRouter.post('/run', async (_req, res) => {
  if (isLabellerPassRunning()) {
    res.status(409).json({ error: 'A labelling pass is already running.' });
    return;
  }

  try {
    const result = await runLabellerPass();
    res.json(result);
  } catch (error) {
    console.error('[labeller] manual pass failed:', error);
    const message = error instanceof Error ? error.message : 'Labelling pass failed.';
    res.status(500).json({ error: message });
  }
});
