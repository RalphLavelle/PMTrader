import { config } from '../config.js';

/**
 * LLM quota backoff — when Ollama Cloud (or any OpenAI-compatible host) returns
 * HTTP 429 / "session usage limit", stop calling the model for a while.
 *
 * The swarm, paper loop, and backtest already have a deterministic path that
 * does not need a language model. Backing off swaps to that path instead of
 * failing every watchlist market and spamming the log.
 */

let backoffUntilMs = 0;

/** True while we should not create or call a chat model. */
export function isLlmBackingOff(now = Date.now()): boolean {
  return now < backoffUntilMs;
}

/** Instant the current backoff ends, or null when the model may be used. */
export function llmBackoffUntil(now = Date.now()): Date | null {
  if (now >= backoffUntilMs) {
    return null;
  }
  return new Date(backoffUntilMs);
}

/** Clear backoff (tests, or an operator who has topped up tokens). */
export function clearLlmBackoff(): void {
  backoffUntilMs = 0;
}

/**
 * True for provider quota / rate-limit failures — including the Ollama Cloud
 * message "429 you (…) have reached your session usage limit".
 */
export function isLlmQuotaError(error: unknown): boolean {
  const status = statusFrom(error);
  if (status === 429) {
    return true;
  }

  const text = messageFrom(error).toLowerCase();
  return (
    /\b429\b/.test(text) ||
    text.includes('session usage limit') ||
    text.includes('rate limit') ||
    text.includes('rate_limit') ||
    text.includes('too many requests')
  );
}

/**
 * If `error` looks like a quota hit, start (or extend) the backoff.
 * Returns true when a backoff is now active because of this error.
 */
export function noteLlmFailure(error: unknown, now = Date.now()): boolean {
  if (!isLlmQuotaError(error)) {
    return false;
  }
  beginLlmBackoff(now);
  return true;
}

/** Start a backoff window from now. Logs once when first entering backoff. */
export function beginLlmBackoff(now = Date.now()): Date {
  const already = isLlmBackingOff(now);
  const until = now + Math.max(1_000, config.llmBackoffMs);
  backoffUntilMs = Math.max(backoffUntilMs, until);
  const untilDate = new Date(backoffUntilMs);

  if (!already) {
    const minutes = Math.round(config.llmBackoffMs / 60_000);
    console.warn(
      `[llm] usage limit hit — backing off until ${untilDate.toISOString()} ` +
        `(~${minutes} min). Swarm runs deterministically until then.`,
    );
  }

  return untilDate;
}

function statusFrom(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const record = error as { status?: unknown; statusCode?: unknown };
  for (const value of [record.status, record.statusCode]) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function messageFrom(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}
