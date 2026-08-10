import { Router, type Request } from 'express';
import {
  backtestSingleMarket,
  getLastBacktest,
  getLastPaperReplay,
  isBacktestRunning,
  paperReplaySingleMarket,
  resolveOptions,
  resolvePaperOptions,
  runBacktestOnce,
  runPaperReplayOnce,
  type BacktestOptions,
  type PaperReplayOptions,
} from '../backtest/index.js';
import { enrichMarketLabelFields } from '../backtest/enrich-markets.js';
import { countLabels, listTradableMarkets } from '../features/coverage.js';
import { countResolvedMarkets } from '../labeller/index.js';
import { connectMongo } from '../memory/mongodb.client.js';
import { parseOptionalFloat, parseOptionalInt } from './jupiter-error.js';

export const backtestRouter = Router();

/**
 * Phase 4 offline evaluation + paper-replay endpoints.
 *
 * Grades intramarket entry→exit trades (Phase 4) and chronological paper
 * portfolios. Resolution is optional context for both.
 */

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

  const exitHoldMinutes = parseOptionalInt(req.query['exitHoldMinutes']);
  if (exitHoldMinutes !== undefined) {
    overrides.exitHoldMinutes = exitHoldMinutes;
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

function paperOptionsFromQuery(req: Request): Partial<PaperReplayOptions> {
  const base = optionsFromQuery(req);
  return {
    maxMarkets: base.maxMarkets,
    decisionIntervalMinutes: base.decisionIntervalMinutes,
    minSnapshots: base.minSnapshots,
    maxSnapshotsPerMarket: base.maxSnapshotsPerMarket,
    minConfidence: base.minConfidence,
    requireOrderbook: base.requireOrderbook,
  };
}

backtestRouter.get('/status', async (_req, res) => {
  try {
    await connectMongo();
    const defaults = resolveOptions();
    const lastPaper = getLastPaperReplay();
    const lastRun = getLastBacktest();

    const [resolvedMarkets, labelledMarkets, sample, enrichedLastRun, enrichedPaperMarkets] =
      await Promise.all([
        countResolvedMarkets(),
        countLabels(),
        listTradableMarkets({ limit: 10, minSnapshots: defaults.minSnapshots }),
        lastRun ? enrichMarketLabelFields(lastRun.markets).then((markets) => ({ ...lastRun, markets })) : Promise.resolve(null),
        lastPaper ? enrichMarketLabelFields(lastPaper.markets) : Promise.resolve(null),
      ]);

    res.json({
      running: isBacktestRunning(),
      defaults,
      paperDefaults: resolvePaperOptions(),
      resolvedMarkets,
      labelledMarkets,
      tradableMarkets: sample.length,
      nextMarkets: sample,
      lastRun: enrichedLastRun,
      lastPaperRun: lastPaper
        ? {
            startedAt: lastPaper.startedAt,
            finishedAt: lastPaper.finishedAt,
            marketsReplayed: lastPaper.marketsReplayed,
            markets: enrichedPaperMarkets ?? lastPaper.markets,
          }
        : null,
    });
  } catch (error) {
    console.error('[backtest] status failed:', error);
    res.status(500).json({ error: 'Failed to read backtest status.' });
  }
});

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
        hint: 'The market needs enough collected snapshots for an entry and a later exit quote.',
      });
      return;
    }

    res.json(detail);
  } catch (error) {
    console.error('[backtest] market replay failed:', error);
    res.status(500).json({ error: 'Failed to replay market.' });
  }
});

/**
 * Chronological paper-trading replay (stateful portfolio).
 *
 * Fill model: buys at ask, sells at bid; depth / slippage / partial fills via
 * PAPER_* env knobs (see README). Never executes at mid.
 * Resolution is not required for the replay to finish.
 */
backtestRouter.post('/paper/run', async (req, res) => {
  if (isBacktestRunning()) {
    res.status(409).json({ error: 'A backtest or paper replay is already running.' });
    return;
  }

  try {
    const summary = await runPaperReplayOnce(paperOptionsFromQuery(req));
    res.json({
      ...summary,
      histories: undefined,
      hint: 'Use GET /api/backtest/paper/markets/:marketId for a full chronological history.',
    });
  } catch (error) {
    console.error('[backtest] paper run failed:', error);
    const message = error instanceof Error ? error.message : 'Paper replay failed.';
    res.status(500).json({ error: message });
  }
});

backtestRouter.get('/paper/markets/:marketId', async (req, res) => {
  const marketId = req.params.marketId;
  if (!marketId) {
    res.status(400).json({ error: 'marketId is required.' });
    return;
  }

  try {
    const history = await paperReplaySingleMarket(
      marketId,
      paperOptionsFromQuery(req),
      req.query['includeContext'] === 'true',
    );
    if (!history) {
      res.status(404).json({
        error: `No paper replay available for ${marketId}.`,
        hint: 'Collect open-path snapshots while the market trades, then retry.',
      });
      return;
    }

    res.json(history);
  } catch (error) {
    console.error('[backtest] paper market replay failed:', error);
    res.status(500).json({ error: 'Failed to paper-replay market.' });
  }
});
