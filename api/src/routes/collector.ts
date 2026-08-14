import { Router } from 'express';
import { loadSchedule, scheduleFilePath } from '../collector/index.js';
import { config } from '../config.js';
import { loadWatchlist, watchlistFilePath } from '../shared/watchlist.js';

export const collectorRouter = Router();

/**
 * Collector status: whether the job is enabled, schedule path, shared watchlist,
 * and last fetch times from schedule.json.
 */
collectorRouter.get('/status', async (_req, res) => {
  try {
    const [schedule, marketIds] = await Promise.all([loadSchedule(), loadWatchlist()]);
    res.json({
      collectorEnabled: config.collectorEnabled,
      schedulePath: scheduleFilePath(),
      watchlistPath: watchlistFilePath(),
      marketIds,
      schedule,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});
