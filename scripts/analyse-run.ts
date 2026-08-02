#!/usr/bin/env npx tsx
/**
 * Generate a plain-English markdown report for a stored swarm run.
 *
 * Usage:
 *   npx tsx scripts/analyse-run.ts
 *   npx tsx scripts/analyse-run.ts --market POLY-3013350
 *   npx tsx scripts/analyse-run.ts --id <run-id>
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../api/src/config.js';
import { connectMongo, disconnectMongo } from '../api/src/memory/mongodb.client.js';
import { MongoAnalysisStore } from '../api/src/memory/mongodb.store.js';
import { summarizeRun } from '../api/src/runs/summarize.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const marketId = readArg('--market');
  const runId = readArg('--id');
  const store = new MongoAnalysisStore();

  await connectMongo();

  try {
    let run = runId ? await store.findById(runId) : null;

    if (!run) {
      const runs = await store.list({
        ...(marketId ? { marketId } : {}),
        limit: 1,
      });
      run = runs[0] ?? null;
    }

    if (!run) {
      throw new Error(
        marketId
          ? `No runs found for market ${marketId}.`
          : 'No runs found in the database.',
      );
    }

    const report = summarizeRun(run);
    const outputDir = resolve(repoRoot, 'docs', 'runs', run.record.marketId);
    const outputPath = resolve(outputDir, `${run.record.id}.md`);

    await mkdir(outputDir, { recursive: true });
    await writeFile(outputPath, report, 'utf8');

    console.log(`Run report written to ${outputPath}`);
    console.log(`Market: ${run.record.marketId}`);
    console.log(`Run id: ${run.record.id}`);
    console.log(`Database: ${config.mongodbDatabase}.${config.mongodbRunsCollection}`);
  } finally {
    await disconnectMongo();
  }
}

main().catch((error) => {
  console.error('Failed to analyse run:', error instanceof Error ? error.message : error);
  process.exit(1);
});
