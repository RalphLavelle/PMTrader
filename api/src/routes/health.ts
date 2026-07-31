import { Router } from 'express';
import { config } from '../config.js';
import { jupiter } from '../jupiter/index.js';

export const healthRouter = Router();

/** Liveness check for the API and Jupiter connectivity status. */
healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    jupiterApiKeyConfigured: jupiter.isConfigured,
    ownerPubkeyConfigured: config.ownerPubkey.length > 0,
  });
});
