import { Router } from 'express';
import { jupiter } from '../jupiter/index.js';
import type { JupiterCreateOrderRequest } from '../jupiter/types.js';
import { sendJupiterError } from './jupiter-error.js';

export const ordersRouter = Router();

/** Create a buy order — proxies Jupiter POST /orders. */
ordersRouter.post('/', async (req, res) => {
  const body = req.body as Partial<JupiterCreateOrderRequest>;

  if (!body.ownerPubkey || !body.marketId || body.isYes === undefined || !body.depositAmount || !body.depositMint) {
    res.status(400).json({
      error: 'Required fields: ownerPubkey, marketId, isYes, depositAmount, depositMint',
    });
    return;
  }

  try {
    const result = await jupiter.createOrder({
      ownerPubkey: body.ownerPubkey,
      marketId: body.marketId,
      isYes: Boolean(body.isYes),
      isBuy: body.isBuy ?? true,
      depositAmount: String(body.depositAmount),
      depositMint: body.depositMint,
      contracts: body.contracts ? String(body.contracts) : undefined,
    });
    res.json(result);
  } catch (error) {
    sendJupiterError(res, error);
  }
});
