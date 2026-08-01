import { Router } from 'express';
import { jupiter } from '../jupiter/index.js';
import type { JupiterCreateOrderRequest } from '../jupiter/types.js';
import { sendJupiterError } from './jupiter-error.js';

export const marketsRouter = Router();

/** Bid/ask depth for a market. */
marketsRouter.get('/:marketId/orderbook', async (req, res) => {
  const marketId = req.params['marketId'];
  if (!marketId) {
    res.status(400).json({ error: 'marketId is required' });
    return;
  }

  try {
    const result = await jupiter.getOrderbook(marketId);
    res.json(result);
  } catch (error) {
    sendJupiterError(res, error);
  }
});

/** Detailed market information including pricing and rules. */
marketsRouter.get('/:marketId', async (req, res) => {
  const marketId = req.params['marketId'];
  if (!marketId) {
    res.status(400).json({ error: 'marketId is required' });
    return;
  }

  try {
    const result = await jupiter.getMarket(marketId);
    res.json(result);
  } catch (error) {
    sendJupiterError(res, error);
  }
});
