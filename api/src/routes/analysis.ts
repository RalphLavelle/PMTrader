import { Router } from 'express';
import { runMarketAnalysis } from '../agent/index.js';

export const analysisRouter = Router();

/** Run the LangGraph market reasoning pipeline on demand. */
analysisRouter.post('/:marketId', async (req, res) => {
  const marketId = req.params['marketId'];
  if (!marketId) {
    res.status(400).json({ error: 'marketId is required' });
    return;
  }

  try {
    const result = await runMarketAnalysis({ marketId });
    res.json(result);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Analysis failed.';
    res.status(500).json({ error: message });
  }
});
