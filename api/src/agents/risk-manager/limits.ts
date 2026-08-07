import { config } from '../../config.js';
import type { RiskLimits } from './logic.js';

/**
 * The risk limits the live swarm actually trades with, read from the environment.
 *
 * `assessRisk` deliberately takes its limits as an argument so the rules can be
 * unit-tested without env vars. This module is the one place that fills those
 * arguments in from configuration, so the live swarm and the offline backtest
 * cannot silently drift apart — a backtest run under different limits than
 * production would be measuring a strategy nobody is running.
 */
export const configuredRiskLimits: RiskLimits = {
  maxPositionUsd: config.swarmMaxPositionUsd,
  minPositionUsd: config.swarmMinPositionUsd,
  minConfidence: config.swarmMinConfidence,
};
