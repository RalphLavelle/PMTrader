import { Router } from 'express';
import { loadSchedule, scheduleFilePath } from '../collector/index.js';
import { config } from '../config.js';

export const collectorRouter = Router();

/**
 * Collector status: whether the job is enabled, schedule path, and last fetch
 * times from collector-schedule.json.
 */
collectorRouter.get('/status', async (_req, res) => {
  try {
    const schedule = await loadSchedule();
    res.json({
      collectorEnabled: config.collectorEnabled,
      schedulePath: scheduleFilePath(),
      schedule,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});
