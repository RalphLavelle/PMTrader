import { Router } from 'express';
import { analysisMemory } from '../memory/index.js';
import { parseOptionalInt } from './jupiter-error.js';

export const runsRouter = Router();

/**
 * List stored swarm runs, newest first.
 *
 * Returns the same shape as `POST /api/swarm/analysis/:marketId` — each item
 * includes `record`, `snapshot`, and `features`.
 */
runsRouter.get('/', async (req, res) => {
  const marketId = typeof req.query['marketId'] === 'string' ? req.query['marketId'] : undefined;
  const limit = parseOptionalInt(req.query['limit']);

  try {
    const runs = await analysisMemory.list({
      ...(marketId ? { marketId } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    res.json(runs);
  } catch (error) {
    console.error('[runs] Failed to list runs:', error);
    res.status(500).json({ error: 'Failed to read stored runs.' });
  }
});

/** Fetch one stored run by record id. */
runsRouter.get('/:id', async (req, res) => {
  const id = req.params['id'];
  if (!id) {
    res.status(400).json({ error: 'id is required' });
    return;
  }

  try {
    const run = await analysisMemory.findById(id);
    if (!run) {
      res.status(404).json({ error: `No run found with id ${id}` });
      return;
    }
    res.json(run);
  } catch (error) {
    console.error('[runs] Failed to read run:', error);
    res.status(500).json({ error: 'Failed to read stored run.' });
  }
});
