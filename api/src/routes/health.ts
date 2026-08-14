import { Router } from 'express';
import { config } from '../config.js';
import { jupiter } from '../jupiter/index.js';
import { llmBackoffUntil } from '../llm/quota.js';

export const healthRouter = Router();

/** Liveness check for the API and Jupiter connectivity status. */
healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    jupiterApiKeyConfigured: jupiter.isConfigured,
    ownerPubkeyConfigured: config.ownerPubkey.length > 0,
    ownerPubkey: config.ownerPubkey || null,
    solanaRpcUrl: config.solanaRpcUrl,
    llmConfigured: config.llmConfigured,
    llmBackingOffUntil: llmBackoffUntil()?.toISOString() ?? null,
  });
});
