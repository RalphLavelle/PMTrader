import { Router, type Request } from 'express';
import {
  BASELINE_WEIGHT,
  getAdaptiveTable,
  weightsForRegime,
  type RegimeContext,
} from '../adaptive/index.js';
import type { BacktestOptions } from '../backtest/index.js';
import { countLabels } from '../features/coverage.js';
import {
  getLastFitness,
  isFitnessRunning,
  resolveFitnessOptions,
  runFitnessOnce,
  type FitnessOptions,
} from '../fitness/index.js';
import { countResolvedMarkets } from '../labeller/index.js';
import { connectMongo } from '../memory/mongodb.client.js';
import { parseOptionalFloat, parseOptionalInt } from './jupiter-error.js';

export const fitnessRouter = Router();

/**
 * Phase 5 fitness + Phase 6 adaptive weight endpoints.
 *
 * Like the backtest there is no background job: a report is always explicitly
 * requested, so these routes are the only way to produce one.
 */

/** Overrides a caller may set in the query string. */
type FitnessOverrides = Partial<FitnessOptions> & Partial<BacktestOptions>;

/**
 * Read overrides from the query string.
 *
 * The replay knobs are flattened rather than nested because they arrive as
 * `?markets=20&intervalMinutes=30`; `resolveFitnessOptions` puts them back into
 * the nested shape after applying the Phase 4 defaults and bounds.
 */
function optionsFromQuery(req: Request): FitnessOverrides {
  const overrides: FitnessOverrides = {};

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

  const maxRuns = parseOptionalInt(req.query['maxRuns']);
  if (maxRuns !== undefined) {
    overrides.maxRuns = maxRuns;
  }

  const minSample = parseOptionalInt(req.query['minSample']);
  if (minSample !== undefined) {
    overrides.minSampleForWeight = minSample;
  }

  if (req.query['requireOrderbook'] === 'true') {
    overrides.requireOrderbook = true;
  }

  // Opt-out rather than opt-in: live runs are the only evidence that can grade
  // the semantic agent, so they should be dropped only when asked for.
  if (req.query['includeLiveRuns'] === 'false') {
    overrides.includeLiveRuns = false;
  }

  return overrides;
}

/**
 * Optional live-market regime for "how have they done when it looked like this?".
 * Pass liquidityScore, hoursToClose, marketYes, hadOrderbook as query params.
 */
function regimeFromQuery(req: Request): RegimeContext | null {
  const liquidityScore = parseOptionalFloat(req.query['liquidityScore']);
  const marketYes = parseOptionalFloat(req.query['marketYes']);
  if (liquidityScore === undefined || marketYes === undefined) {
    return null;
  }

  const hoursRaw = parseOptionalFloat(req.query['hoursToClose']);
  return {
    liquidityScore,
    marketYes,
    hoursToClose: hoursRaw === undefined ? null : hoursRaw,
    hadOrderbook: req.query['hadOrderbook'] === 'true',
  };
}

/** Config, whether a pass is in flight, and how much answer key exists. */
fitnessRouter.get('/status', async (_req, res) => {
  try {
    await connectMongo();

    const [resolvedMarkets, labelledMarkets] = await Promise.all([
      countResolvedMarkets(),
      countLabels(),
    ]);

    res.json({
      running: isFitnessRunning(),
      defaults: resolveFitnessOptions(),
      /** Resolution labels — secondary context for Brier calibration. */
      resolvedMarkets,
      labelledMarkets,
      lastRun: getLastFitness(),
      adaptive: getAdaptiveTable(),
    });
  } catch (error) {
    console.error('[fitness] status failed:', error);
    res.status(500).json({ error: 'Failed to read fitness status.' });
  }
});

/**
 * Compute one fitness report now.
 *
 * Also refreshes Phase 6 adaptive weights used by signal aggregation.
 */
fitnessRouter.post('/run', async (req, res) => {
  if (isFitnessRunning()) {
    res.status(409).json({ error: 'A fitness pass is already running.' });
    return;
  }

  try {
    const report = await runFitnessOnce(optionsFromQuery(req));
    res.json({
      ...report,
      adaptive: getAdaptiveTable(),
    });
  } catch (error) {
    console.error('[fitness] run failed:', error);
    const message = error instanceof Error ? error.message : 'Fitness pass failed.';
    res.status(500).json({ error: message });
  }
});

/**
 * Current adaptive weights with the evidence behind each number.
 *
 * Optional regime query params re-blend each agent's weight toward how they
 * performed when the market looked like the live one:
 * `?liquidityScore=0.7&hoursToClose=2&marketYes=0.55&hadOrderbook=true`
 */
fitnessRouter.get('/weights', (req, res) => {
  const regime = regimeFromQuery(req);
  const table = regime ? weightsForRegime(regime) : getAdaptiveTable();

  if (!table) {
    res.status(404).json({
      error: 'No adaptive weights have been published yet.',
      hint: 'POST /api/fitness/run first so paper-trade fitness can feed the weight table.',
      baselineWeight: BASELINE_WEIGHT,
    });
    return;
  }

  res.json({
    computedAt: table.computedAt,
    sourceFitnessAt: table.sourceFitnessAt,
    baselineWeight: table.baselineWeight,
    options: table.options,
    regimeQuery: regime,
    warnings: table.warnings,
    agents: table.agents.map((agent) => ({
      agent: agent.agent,
      currentWeight: agent.currentWeight,
      baselineWeight: agent.baselineWeight,
      sampleCount: agent.sampleCount,
      recentPnlUsd: agent.recentPnlUsd,
      longTermPnlUsd: agent.longTermPnlUsd,
      drawdownUsd: agent.drawdownUsd,
      regime: agent.regime,
      evidenceLevel: agent.evidenceLevel,
      overallFitness: agent.overallFitness,
      recentFitness: agent.recentFitness,
      confidenceAdjustedFitness: agent.confidenceAdjustedFitness,
      consistency: agent.consistency,
      effectiveFitness: agent.effectiveFitness,
      rationale: agent.rationale,
    })),
  });
});

/** Full drill-down for one specialist, so a surprising weight can be inspected. */
fitnessRouter.get('/agents/:agent', (req, res) => {
  const report = getLastFitness();
  if (!report) {
    res.status(404).json({
      error: 'No fitness pass has run since the API started.',
      hint: 'POST /api/fitness/run first.',
    });
    return;
  }

  const agent = report.agents.find((entry) => entry.agent === req.params.agent);
  if (!agent) {
    res.status(404).json({
      error: `No graded stances for ${req.params.agent}.`,
      hint: 'The agent may not have taken part in any replayed or scored run.',
      available: report.agents.map((entry) => entry.agent),
    });
    return;
  }

  const adaptive = getAdaptiveTable()?.agents.find((row) => row.agent === agent.agent) ?? null;
  res.json({ ...agent, adaptive });
});
