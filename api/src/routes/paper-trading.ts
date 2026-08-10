import { Router } from 'express';
import { config } from '../config.js';
import { getAdaptiveTable } from '../adaptive/index.js';
import { connectMongo } from '../memory/mongodb.client.js';
import {
  getLastLivePaperPass,
  isLivePaperPassRunning,
  runLivePaperPassOnce,
} from '../trading/live-runner.js';
import {
  initLivePaperStore,
  listClosedTrades,
  listMarketStates,
  summarisePortfolio,
} from '../trading/live-store.js';

export const paperTradingRouter = Router();

/**
 * Live paper-trading status and manual trigger.
 *
 * PAPER TRADING ONLY — these endpoints never place real Jupiter orders.
 */

paperTradingRouter.get('/status', async (_req, res) => {
  try {
    await connectMongo();
    await initLivePaperStore();
    const portfolio = await summarisePortfolio();
    const markets = await listMarketStates(50);
    const openMarkets = markets.filter((row) => row.portfolio.position !== null);

    res.json({
      enabled: config.paperTradingEnabled,
      running: isLivePaperPassRunning(),
      intervalMs: config.paperTradingIntervalMs,
      decisionIntervalMinutes: config.paperTradingDecisionIntervalMinutes,
      staleMs: config.paperTradingStaleMs,
      maxMarkets: config.paperTradingMaxMarkets,
      paperOnly: true,
      portfolio,
      openPositions: openMarkets.map((row) => ({
        marketId: row.marketId,
        title: row.title,
        side: row.portfolio.position?.side ?? null,
        sizeUsd: row.portfolio.position?.sizeUsd ?? null,
        entryAt: row.portfolio.position?.entryAt ?? null,
        entryPriceUsd: row.portfolio.position?.entryPriceUsd ?? null,
        unrealisedPnlUsd: row.unrealisedPnlUsd,
        realisedPnlUsd: row.portfolio.realisedPnlUsd,
        marketStatus: row.marketStatus,
        updatedAt: row.updatedAt,
      })),
      adaptive: getAdaptiveTable(),
      lastPass: getLastLivePaperPass(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

paperTradingRouter.get('/trades', async (req, res) => {
  try {
    await connectMongo();
    await initLivePaperStore();
    const limit = Math.min(
      500,
      Math.max(1, Number(req.query['limit'] ?? 100) || 100),
    );
    const trades = await listClosedTrades(limit);
    res.json({ paperOnly: true, count: trades.length, trades });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

paperTradingRouter.post('/run', async (_req, res) => {
  try {
    if (isLivePaperPassRunning()) {
      res.status(409).json({ error: 'A live paper-trading pass is already running.' });
      return;
    }
    const result = await runLivePaperPassOnce();
    res.json({ paperOnly: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});
