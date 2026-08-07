import { Router, type Request } from 'express';
import {
  backtestSingleMarket,
  getLastBacktest,
  isBacktestRunning,
  resolveOptions,
  runBacktestOnce,
  type BacktestOptions,
} from '../backtest/index.js';
import { countLabels, listLabelledMarkets } from '../features/coverage.js';
import { countResolvedMarkets } from '../labeller/index.js';
import { connectMongo } from '../memory/mongodb.client.js';
import { parseOptionalFloat, parseOptionalInt } from './jupiter-error.js';

export const backtestRouter = Router();

/**
 * Phase 4 offline evaluation endpoints.
 *
 * A backtest is always explicitly requested — there is no background job — so
 * these routes are the only way to run one.
 */

/** Read backtest option overrides from the query string. */
function optionsFromQuery(req: Request): Partial<BacktestOptions> {
  const overrides: Partial<BacktestOptions> = {};

  const markets = parseOptionalInt(req.query['markets']);
  if (markets !== undefined) {
    overrides.maxMarkets = markets;
  }

  const intervalMinutes = parseOptionalInt(req.query['intervalMinutes']);
  if (intervalMinutes !== undefined) {
    overrides.decisionIntervalMinutes = intervalMinutes;
  }

  const minSnapshots = parseOptionalInt(req.query['minSnapshots']);
  if (minSnapshots !== undefined) {
    overrides.minSnapshots = minSnapshots;
  }

  const minConfidence = parseOptionalFloat(req.query['minConfidence']);
  if (minConfidence !== undefined) {
    overrides.minConfidence = minConfidence;
  }

  if (req.query['requireOrderbook'] === 'true') {
    overrides.requireOrderbook = true;
  }

  return overrides;
}

/** Config, whether a run is in flight, and how much answer key exists to test against. */
backtestRouter.get('/status', async (_req, res) => {
  try {
    await connectMongo();

    const [resolvedMarkets, labelledMarkets, sample] = await Promise.all([
      countResolvedMarkets(),
      countLabels(),
      listLabelledMarkets(10),
    ]);

    res.json({
      running: isBacktestRunning(),
      defaults: resolveOptions(),
      /** Markets with a decisive result — the only ones a backtest can grade. */
      resolvedMarkets,
      labelledMarkets,
      /** A preview of what the next run would replay. */
      nextMarkets: sample,
      lastRun: getLastBacktest(),
    });
  } catch (error) {
    console.error('[backtest] status failed:', error);
    res.status(500).json({ error: 'Failed to read backtest status.' });
  }
});

/**
 * Run one backtest now.
 *
 * POST rather than GET because it is a deliberate, expensive action, even
 * though it changes no stored state.
 */
backtestRouter.post('/run', async (req, res) => {
  if (isBacktestRunning()) {
    res.status(409).json({ error: 'A backtest is already running.' });
    return;
  }

  try {
    const summary = await runBacktestOnce(optionsFromQuery(req));
    res.json(summary);
  } catch (error) {
    console.error('[backtest] run failed:', error);
    const message = error instanceof Error ? error.message : 'Backtest failed.';
    res.status(500).json({ error: message });
  }
});

/** Every graded decision for one resolved market. */
backtestRouter.get('/markets/:marketId', async (req, res) => {
  const marketId = req.params.marketId;
  if (!marketId) {
    res.status(400).json({ error: 'marketId is required.' });
    return;
  }

  try {
    const detail = await backtestSingleMarket(marketId, optionsFromQuery(req));
    if (!detail) {
      res.status(404).json({
        error: `No backtest available for ${marketId}.`,
        hint: 'The market needs a decisive yes/no label and enough collected snapshots.',
      });
      return;
    }

    res.json(detail);
  } catch (error) {
    console.error('[backtest] market replay failed:', error);
    res.status(500).json({ error: 'Failed to replay market.' });
  }
});
