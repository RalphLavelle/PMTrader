/**
 * Public entry point for every structured contract in the swarm.
 *
 * Importing from `../schemas/index.js` (rather than reaching into individual
 * files) keeps agent and glue code decoupled from how the schemas are grouped.
 */
export * from './common.js';
export * from './market.js';
export * from './signals.js';
export * from './risk.js';
export * from './analysis.js';
