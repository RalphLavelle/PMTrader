import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { analysisRecordSchema, type AnalysisRecord, type TradeOutcome } from '../schemas/index.js';
import { applyQuery, type AnalysisMemoryStore, type AnalysisQuery } from './types.js';

/**
 * Analysis store that persists to a JSON file on disk.
 *
 * Chosen as the first durable driver because it needs no external service, yet
 * survives restarts — enough for a scheduler to accumulate history that a future
 * Learning Agent can score. For higher volumes, swap in a SQLite or PostgreSQL
 * implementation of `AnalysisMemoryStore`; nothing outside this file changes.
 *
 * Writes are serialised through a promise chain and go via a temporary file that
 * is then renamed. Rename is atomic on the same filesystem, so a crash mid-write
 * cannot leave a half-written file behind.
 */
export class JsonFileAnalysisStore implements AnalysisMemoryStore {
  readonly driver = 'json-file';

  /** Tail of the write queue; each write waits for the previous one. */
  private writeQueue: Promise<void> = Promise.resolve();

  /** Cached records, loaded lazily on first access. */
  private cache: Map<string, AnalysisRecord> | null = null;

  constructor(private readonly filePath: string) {}

  async save(record: AnalysisRecord): Promise<AnalysisRecord> {
    const cache = await this.load();
    const stored: AnalysisRecord = { ...record };
    cache.set(stored.id, stored);
    await this.flush();
    return stored;
  }

  async findById(id: string): Promise<AnalysisRecord | null> {
    const cache = await this.load();
    return cache.get(id) ?? null;
  }

  async list(query?: AnalysisQuery): Promise<AnalysisRecord[]> {
    const cache = await this.load();
    return applyQuery([...cache.values()], query);
  }

  async recordOutcome(id: string, outcome: TradeOutcome): Promise<AnalysisRecord | null> {
    const cache = await this.load();
    const existing = cache.get(id);
    if (!existing) {
      return null;
    }

    const updated: AnalysisRecord = { ...existing, outcome };
    cache.set(id, updated);
    await this.flush();
    return updated;
  }

  async clear(): Promise<void> {
    this.cache = new Map();
    await this.flush();
  }

  /**
   * Read the file into memory once, tolerating a missing or corrupt file.
   *
   * Records that fail schema validation are skipped rather than throwing, so one
   * bad entry written by an older version cannot make the whole store unusable.
   */
  private async load(): Promise<Map<string, AnalysisRecord>> {
    if (this.cache) {
      return this.cache;
    }

    const cache = new Map<string, AnalysisRecord>();

    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const result = analysisRecordSchema.safeParse(entry);
          if (result.success) {
            cache.set(result.data.id, result.data);
          } else {
            console.warn('[memory] Skipping malformed analysis record in store file.');
          }
        }
      }
    } catch (error) {
      // ENOENT simply means "no history yet"; anything else is worth surfacing.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[memory] Could not read analysis store, starting empty:', error);
      }
    }

    this.cache = cache;
    return cache;
  }

  /** Queue an atomic write of the current cache to disk. */
  private flush(): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this.writeNow());
    return this.writeQueue;
  }

  private async writeNow(): Promise<void> {
    const records = [...(this.cache?.values() ?? [])];
    const tempPath = `${this.filePath}.tmp`;

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(tempPath, JSON.stringify(records, null, 2), 'utf8');
    await rename(tempPath, this.filePath);
  }
}
