/**
 * Drops every collection in the PMTrader MongoDB database.
 * Uses the same config as the API (repo-root .env + defaults).
 */
import { MongoClient } from 'mongodb';
import { config } from '../api/src/config.js';

async function main(): Promise<void> {
  const client = new MongoClient(config.mongodbUri);
  await client.connect();

  const db = client.db(config.mongodbDatabase);
  const before = await db.listCollections().toArray();

  console.log(`Database: ${config.mongodbDatabase}`);
  console.log(`URI: ${config.mongodbUri}`);

  if (before.length === 0) {
    console.log('Already empty — no collections found.');
    await client.close();
    return;
  }

  for (const col of before) {
    const count = await db.collection(col.name).countDocuments();
    console.log(`  ${col.name}: ${count} document(s)`);
  }

  const dropped = await db.dropDatabase();
  console.log(`dropDatabase: ${dropped ? 'success' : 'failed'}`);

  const after = await db.listCollections().toArray();
  console.log(`Collections remaining: ${after.length === 0 ? 'none' : after.map((c) => c.name).join(', ')}`);

  await client.close();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
