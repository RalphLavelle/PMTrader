import { config } from '../config.js';
import { InMemoryAnalysisStore } from './in-memory.store.js';
import { JsonFileAnalysisStore } from './json-file.store.js';
import type { AnalysisMemoryStore } from './types.js';

export type { AnalysisMemoryStore, AnalysisQuery } from './types.js';
export { InMemoryAnalysisStore } from './in-memory.store.js';
export { JsonFileAnalysisStore } from './json-file.store.js';

/**
 * Build the store named by `MEMORY_DRIVER`.
 *
 * Exported separately from the singleton so tests can construct an isolated
 * store without touching the shared instance.
 */
export function createAnalysisStore(
  driver: string = config.memoryDriver,
  filePath: string = config.memoryFilePath,
): AnalysisMemoryStore {
  switch (driver) {
    case 'file':
      return new JsonFileAnalysisStore(filePath);
    case 'memory':
      return new InMemoryAnalysisStore();
    default:
      console.warn(`[memory] Unknown MEMORY_DRIVER "${driver}" — falling back to in-memory.`);
      return new InMemoryAnalysisStore();
  }
}

/** Shared store used by the swarm runner and the analysis routes. */
export const analysisMemory: AnalysisMemoryStore = createAnalysisStore();
