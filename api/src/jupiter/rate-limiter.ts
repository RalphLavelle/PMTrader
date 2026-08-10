/** Minimal shape for Jupiter HTTP errors — avoids importing the full client. */
export interface HttpStatusError {
  status: number;
}

function is429(error: unknown): error is HttpStatusError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as HttpStatusError).status === 429
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serialises every Jupiter HTTP call through one queue with a minimum gap.
 *
 * Collector, swarm, labeller, and route handlers all share the singleton
 * instance wired into {@link JupiterClient}, so bursts from different
 * subsystems cannot race each other into 429s.
 */
export class JupiterRateLimiter {
  private tail: Promise<unknown> = Promise.resolve();
  private lastStartMs = 0;

  constructor(
    private readonly minIntervalMs: number,
    private readonly max429Retries: number,
    private readonly retryDelayMs: number,
  ) {}

  /** Queue `task` after prior calls finish and the min interval has elapsed. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(() => this.runWithRetry(task));
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async runWithRetry<T>(task: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt <= this.max429Retries; attempt += 1) {
      await this.waitForSlot();
      try {
        return await task();
      } catch (error) {
        if (!is429(error) || attempt >= this.max429Retries) {
          throw error;
        }
        const backoff = this.retryDelayMs * (attempt + 1);
        await sleep(backoff);
      }
    }
    throw new Error('Jupiter rate limiter: exhausted retries');
  }

  private async waitForSlot(): Promise<void> {
    const now = Date.now();
    const waitMs = Math.max(0, this.lastStartMs + this.minIntervalMs - now);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    this.lastStartMs = Date.now();
  }
}

/** Default gap: ~54 req/min with a key, ~30/min keyless (0.5 RPS). */
export function defaultJupiterMinIntervalMs(hasApiKey: boolean): number {
  return hasApiKey ? 1_100 : 2_000;
}
