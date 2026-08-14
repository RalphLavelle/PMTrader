/**
 * Paper entry gate tests.
 *
 * The gate exists because the 2026-08-11 fitness pass showed spread costs on
 * incoherent quotes were ~85% of paper losses. These cases pin the two rules:
 * quote coherence (yes+no ≈ $1.00) and a minimum liquidity floor.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { entryBlockReason } from './entry-gate.js';

describe('paper entry gate', () => {
  it('allows a coherent, liquid market', () => {
    const reason = entryBlockReason({
      buyYesPriceUsd: 0.6,
      buyNoPriceUsd: 0.42,
      liquidityScore: 0.5,
    });
    assert.equal(reason, null);
  });

  it('blocks a wide quote like the real losing trades (yes+no ≈ $1.47)', () => {
    const reason = entryBlockReason({
      buyYesPriceUsd: 0.5,
      buyNoPriceUsd: 0.97,
      liquidityScore: 0.5,
    });
    assert.ok(reason, 'expected a block reason');
    assert.match(reason, /incoherent/);
  });

  it('blocks a zero-liquidity market even when the quote looks tight', () => {
    const reason = entryBlockReason({
      buyYesPriceUsd: 0.6,
      buyNoPriceUsd: 0.41,
      liquidityScore: 0,
    });
    assert.ok(reason, 'expected a block reason');
    assert.match(reason, /liquidity/);
  });

  it('sits exactly on the boundary without blocking', () => {
    // Default max quote sum is 1.05 — a sum of exactly 1.05 must pass, since
    // the winning live trade entered at that level.
    const reason = entryBlockReason({
      buyYesPriceUsd: 0.35,
      buyNoPriceUsd: 0.7,
      liquidityScore: 0.15,
    });
    assert.equal(reason, null);
  });
});
