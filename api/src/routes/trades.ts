import { Router } from 'express';
import { config } from '../config.js';
import { jupiter } from '../jupiter/index.js';
import { parseOptionalInt, sendJupiterError } from './jupiter-error.js';

export const tradesRouter = Router();

/** Global recent trades from Jupiter (platform-wide activity feed). */
tradesRouter.get('/', async (_req, res) => {
  try {
    const result = await jupiter.getTrades();
    res.json(result);
  } catch (error) {
    sendJupiterError(res, error);
  }
});

/**
 * Account history for a wallet — defaults to OWNER_PUBKEY from env.
 * Query: ?ownerPubkey=...&start=0&end=50
 */
tradesRouter.get('/history', async (req, res) => {
  const ownerPubkey =
    (typeof req.query['ownerPubkey'] === 'string' ? req.query['ownerPubkey'] : '') ||
    config.ownerPubkey;

  if (!ownerPubkey) {
    res.status(400).json({
      error: 'ownerPubkey is required. Set OWNER_PUBKEY in .env or pass ?ownerPubkey=',
    });
    return;
  }

  const start = parseOptionalInt(req.query['start']);
  const end = parseOptionalInt(req.query['end']);

  try {
    const result = await jupiter.getHistory(ownerPubkey, start, end);
    res.json(result);
  } catch (error) {
    sendJupiterError(res, error);
  }
});
