/**
 * Formatting helpers for research statistics.
 *
 * These live outside the components because the backtest and fitness dashboards
 * must render "no data" identically. A page that shows `0.0%` where another
 * shows `—` invites a reader to treat "we measured zero" and "we could not
 * measure" as the same thing, which is the single easiest way to misread any of
 * these reports.
 */

/** Shown wherever a value is null, i.e. there was not enough data to say. */
const NO_VALUE = '—';

/** A 0..1 ratio as a percentage, or a dash when it could not be computed. */
export function percentOrDash(value: number | null, decimals = 1): string {
  return value === null ? NO_VALUE : `${(value * 100).toFixed(decimals)}%`;
}

/**
 * A signed percentage, for values where the direction is the point.
 *
 * Skill and overconfidence are both meaningful in either direction, so an
 * explicit `+` stops a reader having to hunt for the minus sign to tell a good
 * result from a bad one.
 */
export function signedPercentOrDash(value: number | null, decimals = 1): string {
  if (value === null) {
    return NO_VALUE;
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(decimals)}%`;
}

/** A plain number to fixed precision, or a dash when it is null. */
export function fixedOrDash(value: number | null, decimals = 3): string {
  return value === null ? NO_VALUE : value.toFixed(decimals);
}

/** A USD amount with a proper minus sign rather than a hyphen. */
export function moneyUsd(value: number): string {
  const sign = value < 0 ? '−' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

/** Agent ids are stored snake_case; titles read better in the UI. */
export function humaniseAgent(agent: string): string {
  return agent.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
