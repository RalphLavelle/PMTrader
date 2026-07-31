import { JupiterApiError } from '../jupiter/client.js';

export function sendJupiterError(res: import('express').Response, error: unknown): void {
  if (error instanceof JupiterApiError) {
    res.status(error.status).json({ error: error.message, details: error.body });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
}

export function parseOptionalInt(value: unknown): number | undefined {
  if (typeof value !== 'string' || value === '') {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function queryString(
  req: import('express').Request,
  keys: string[],
): Record<string, string> {
  const query: Record<string, string> = {};
  for (const key of keys) {
    const value = req.query[key];
    if (typeof value === 'string' && value !== '') {
      query[key] = value;
    }
  }
  return query;
}
