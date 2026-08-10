/**
 * Clear, greppable logs for the continuous paper-trading loop.
 *
 * Prefix `[paper]` so operators can filter a noisy API log stream.
 */

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'n/a';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}$${value.toFixed(2)}`;
}

/** Simulated entry filled. */
export function logEntry(
  marketId: string,
  side: string,
  sizeUsd: number,
  fillPriceUsd: number,
): void {
  console.log(
    `[paper] ENTRY ${marketId} side=${side} size=$${sizeUsd.toFixed(2)} fill=${fillPriceUsd.toFixed(4)}`,
  );
}

/** Simulated exit filled (full or partial). */
export function logExit(
  marketId: string,
  side: string,
  netPnlUsd: number,
  fillPriceUsd: number,
  partial: boolean,
): void {
  console.log(
    `[paper] EXIT ${marketId} side=${side} pnl=${money(netPnlUsd)} fill=${fillPriceUsd.toFixed(4)}${partial ? ' (partial)' : ''}`,
  );
}

/** Cumulative / mark-to-market PnL pulse after a meaningful step. */
export function logPnl(
  marketId: string,
  realisedPnlUsd: number,
  unrealisedPnlUsd: number | null,
): void {
  console.log(
    `[paper] P&L ${marketId} realised=${money(realisedPnlUsd)} unrealised=${money(unrealisedPnlUsd)}`,
  );
}

/** Proposed trade rejected by fill guards (no inventory, no price, depth, etc.). */
export function logRejectedTrade(
  marketId: string,
  action: string,
  reason: string,
): void {
  console.log(`[paper] REJECTED ${marketId} action=${action} reason=${reason}`);
}

/** Collector tip is too old to trust for a new decision. */
export function logStaleData(marketId: string, ageMs: number, maxAgeMs: number): void {
  const ageMin = (ageMs / 60_000).toFixed(1);
  const maxMin = (maxAgeMs / 60_000).toFixed(1);
  console.warn(
    `[paper] STALE ${marketId} age=${ageMin}m (max ${maxMin}m) — skipping decision`,
  );
}

/** Risk manager vetoed the blended proposal. */
export function logRiskVeto(marketId: string, reasons: string[]): void {
  console.log(`[paper] RISK_VETO ${marketId} ${reasons.join('; ') || 'unspecified'}`);
}

/** Adaptive weights republished after live closed trades. */
export function logAdaptiveWeightUpdate(
  agents: Array<{ agent: string; weight: number; sampleCount: number }>,
): void {
  const summary = agents
    .map((row) => `${row.agent}=${row.weight.toFixed(3)}(n=${row.sampleCount})`)
    .join(' ');
  console.log(`[paper] ADAPTIVE_WEIGHTS ${summary || '(baseline)'}`);
}
