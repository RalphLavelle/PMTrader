import { Router } from 'express';
import { jupiter } from '../jupiter/index.js';
import { sendJupiterError } from './jupiter-error.js';

export const tradingStatusRouter = Router();

/** Whether Jupiter prediction markets are actively trading. */
tradingStatusRouter.get('/', async (_req, res) => {
  try {
    const result = await jupiter.getTradingStatus();
    res.json(result);
  } catch (error) {
    sendJupiterError(res, error);
  }
});
