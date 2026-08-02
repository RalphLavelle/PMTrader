import { MongoClient, type Collection, type Db } from 'mongodb';
import type { SwarmAnalysisResult } from '../schemas/index.js';
import { config } from '../config.js';

/** Shared MongoDB client — opened once when the API starts. */
let client: MongoClient | null = null;
let database: Db | null = null;

/** Open the MongoDB connection and ensure indexes exist on the runs collection. */
export async function connectMongo(): Promise<void> {
  if (database) {
    return;
  }

  client = new MongoClient(config.mongodbUri);
  await client.connect();
  database = client.db(config.mongodbDatabase);

  const runs = getRunsCollection();
  await runs.createIndex({ 'record.id': 1 }, { unique: true, sparse: true });
  await runs.createIndex({ id: 1 }, { unique: true, sparse: true });
  await runs.createIndex({ 'record.timestamp': -1 });
  await runs.createIndex({ timestamp: -1 });
  await runs.createIndex({ 'record.marketId': 1, 'record.timestamp': -1 });
  await runs.createIndex({ marketId: 1, timestamp: -1 });
}

/** Return the `runs` collection after `connectMongo` has succeeded. */
export function getRunsCollection(): Collection<SwarmAnalysisResult> {
  if (!database) {
    throw new Error('MongoDB is not connected. Call connectMongo() during startup.');
  }

  return database.collection<SwarmAnalysisResult>(config.mongodbRunsCollection);
}

/** Close the MongoDB connection — used by tests and graceful shutdown. */
export async function disconnectMongo(): Promise<void> {
  await client?.close();
  client = null;
  database = null;
}
