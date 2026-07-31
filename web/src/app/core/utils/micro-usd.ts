const MICRO_USD = 1_000_000;

/** Convert Jupiter micro-USD values to a display dollar amount. */
export function formatMicroUsd(microUsd: string | number | undefined | null): string {
  if (!microUsd) {
    return '—';
  }
  const value = Number(microUsd) / MICRO_USD;
  if (Number.isNaN(value)) {
    return '—';
  }
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Format a Unix timestamp (seconds) for display. */
export function formatTimestamp(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString();
}
