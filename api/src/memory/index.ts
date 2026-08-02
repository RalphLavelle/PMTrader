import { connectMongo } from './mongodb.client.js';
import { MongoAnalysisStore } from './mongodb.store.js';
import type { AnalysisMemoryStore } from './types.js';

export type { AnalysisMemoryStore, AnalysisQuery } from './types.js';
export { MongoAnalysisStore } from './mongodb.store.js';
export { connectMongo, disconnectMongo } from './mongodb.client.js';

/** Shared store used by the swarm runner and the analysis routes. */
export const analysisMemory: AnalysisMemoryStore = new MongoAnalysisStore();

/** Connect to MongoDB before accepting traffic. */
export async function initAnalysisMemory(): Promise<void> {
  await connectMongo();
}
