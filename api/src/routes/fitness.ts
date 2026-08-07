import { Router, type Request } from 'express';
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
import { parseOptionalInt } from './jupiter-error.js';

export const fitnessRouter = Router();

/**
 * Phase 5 agent fitness endpoints.
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
      /** Markets with a decisive result — the only ones a stance can be graded on. */
      resolvedMarkets,
      labelledMarkets,
      lastRun: getLastFitness(),
    });
  } catch (error) {
    console.error('[fitness] status failed:', error);
    res.status(500).json({ error: 'Failed to read fitness status.' });
  }
});

/**
 * Compute one fitness report now.
 *
 * POST rather than GET because it replays every resolved market, which is
 * deliberate and expensive even though it changes no stored state.
 */
fitnessRouter.post('/run', async (req, res) => {
  if (isFitnessRunning()) {
    res.status(409).json({ error: 'A fitness pass is already running.' });
    return;
  }

  try {
    const report = await runFitnessOnce(optionsFromQuery(req));
    res.json(report);
  } catch (error) {
    console.error('[fitness] run failed:', error);
    const message = error instanceof Error ? error.message : 'Fitness pass failed.';
    res.status(500).json({ error: message });
  }
});

/**
 * The weights Phase 6 would apply, without any of the workings.
 *
 * A deliberately small response, because this is the machine-readable output of
 * the whole phase: the adaptive Risk Manager needs a number per agent, not a
 * report. Serves the last completed pass rather than computing a new one, so it
 * stays cheap enough to call on every swarm run.
 */
fitnessRouter.get('/weights', (_req, res) => {
  const report = getLastFitness();
  if (!report) {
    res.status(404).json({
      error: 'No fitness pass has run since the API started.',
      hint: 'POST /api/fitness/run first.',
    });
    return;
  }

  res.json({
    computedAt: report.finishedAt,
    gradedStances: report.gradedStances,
    weights: report.agents.map((agent) => ({
      agent: agent.agent,
      weight: agent.weight.weight,
      reliable: agent.weight.reliable,
      sampleSize: agent.weight.sampleSize,
      rationale: agent.weight.rationale,
    })),
    warnings: report.warnings,
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

  res.json(agent);
});
