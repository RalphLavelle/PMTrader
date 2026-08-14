/**
 * Exit-gate tests — fixed vs trailing seatbelt, frozen at entry.
 *
 * Cheap fills (≤ $0.50) trail; expensive fills get a hard percent floor.
 * Limits are injected so these cases do not depend on the process env.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bakeStopRecipe,
  chooseStopKind,
  closedExitReason,
  DEFAULT_STOP_LIMITS,
  exitHitReason,
  ratchetTrailingStop,
  type StopLimits,
} from './exit-gate.js';
import type { PaperPosition } from './paper-types.js';

const LIMITS: StopLimits = { ...DEFAULT_STOP_LIMITS };
const ENTRY = '2026-01-01T10:00:00.000Z';
/** Just after the default 60-minute trail grace. */
const AFTER_GRACE = new Date('2026-01-01T11:00:00.000Z');
/** Still inside the grace window. */
const DURING_GRACE = new Date('2026-01-01T10:30:00.000Z');

function lot(overrides: Partial<PaperPosition> = {}): PaperPosition {
  return {
    side: 'yes',
    sizeUsd: 10,
    contracts: 25,
    entryAt: ENTRY,
    entryPriceUsd: 0.4,
    mfeUsd: 0,
    maeUsd: 0,
    ...overrides,
  };
}

describe('stop kind by trade type', () => {
  it('uses a trailing stop on cheap-side fills (mean-reversion style)', () => {
    assert.equal(chooseStopKind(0.35, LIMITS), 'trailing_price');
    assert.equal(chooseStopKind(0.5, LIMITS), 'trailing_price');
  });

  it('uses a fixed percent floor on expensive-side fills (trend style)', () => {
    assert.equal(chooseStopKind(0.51, LIMITS), 'percent_loss');
    assert.equal(chooseStopKind(0.85, LIMITS), 'percent_loss');
  });
});

describe('bakeStopRecipe', () => {
  it('freezes a trailing recipe on a $0.40 fill (40% trail → $0.16, floor $0.24)', () => {
    const baked = bakeStopRecipe(0.4, ENTRY, LIMITS);
    assert.equal(baked.stopKind, 'trailing_price');
    assert.equal(baked.trailDistanceUsd, 0.16);
    assert.equal(baked.stopPriceUsd, 0.24);
    assert.equal(baked.trailArmedAt, '2026-01-01T11:00:00.000Z');
    assert.equal(baked.timeStopAt, '2026-01-02T10:00:00.000Z');
    assert.equal(baked.timeStopNeedProfit, true);
  });

  it('freezes a −30% floor on a $0.80 fill → sell bid $0.56 (no trail grace)', () => {
    const baked = bakeStopRecipe(0.8, ENTRY, LIMITS);
    assert.equal(baked.stopKind, 'percent_loss');
    assert.equal(baked.stopPriceUsd, 0.56);
    assert.equal(baked.trailDistanceUsd, undefined);
    assert.equal(baked.trailArmedAt, undefined);
  });

  it('bakes nothing when the seatbelt is switched off', () => {
    const baked = bakeStopRecipe(0.4, ENTRY, { ...LIMITS, enabled: false });
    assert.deepEqual(baked, {});
  });
});

describe('fixed percent stop', () => {
  it('sells when the bid prints at or below the frozen floor (no grace)', () => {
    const position = lot({
      entryPriceUsd: 0.8,
      contracts: 12.5,
      ...bakeStopRecipe(0.8, ENTRY, LIMITS),
    });
    assert.equal(exitHitReason(position, 0.57, -2.88, new Date(ENTRY)), null);
    assert.equal(exitHitReason(position, 0.56, -3, new Date(ENTRY)), 'stop_loss');
  });
});

describe('trailing stop', () => {
  it('ratchets the floor up with the bid and never walks it back', () => {
    const opened = lot({
      ...bakeStopRecipe(0.4, ENTRY, LIMITS),
    });
    assert.equal(opened.stopPriceUsd, 0.24);

    // Peak at 0.60 → floor = 0.60 − 0.16 = 0.44
    const afterRun = ratchetTrailingStop(opened, 0.6);
    assert.equal(afterRun.stopPriceUsd, 0.44);

    const afterDip = ratchetTrailingStop(afterRun, 0.55);
    assert.equal(afterDip.stopPriceUsd, 0.44);
  });

  it('ignores a trail hit during the grace window', () => {
    const position = lot({ ...bakeStopRecipe(0.4, ENTRY, LIMITS) });
    // Bid already below the initial floor, but grace has not expired.
    assert.equal(exitHitReason(position, 0.2, -5, DURING_GRACE), null);
  });

  it('sells on a pullback to the ratcheted floor after grace', () => {
    const peaked = ratchetTrailingStop(
      lot({ ...bakeStopRecipe(0.4, ENTRY, LIMITS) }),
      0.6,
    );
    assert.equal(peaked.stopPriceUsd, 0.44);
    assert.equal(exitHitReason(peaked, 0.45, 1.25, AFTER_GRACE), null);
    assert.equal(exitHitReason(peaked, 0.44, 1, AFTER_GRACE), 'trailing_stop');
  });

  it('arms immediately when trailGraceMinutes is 0', () => {
    const noGrace: StopLimits = { ...LIMITS, trailGraceMinutes: 0 };
    const position = lot({ ...bakeStopRecipe(0.4, ENTRY, noGrace) });
    assert.equal(position.trailArmedAt, ENTRY);
    assert.equal(exitHitReason(position, 0.24, -4, new Date(ENTRY)), 'trailing_stop');
  });
});

describe('time stop', () => {
  it('cuts a still-losing hold after 24 hours, but not a winner', () => {
    const position = lot({ ...bakeStopRecipe(0.4, ENTRY, LIMITS) });
    const almost = new Date('2026-01-02T09:59:00.000Z');
    const due = new Date('2026-01-02T10:00:00.000Z');

    assert.equal(exitHitReason(position, 0.38, -0.5, almost), null);
    assert.equal(exitHitReason(position, 0.38, -0.5, due), 'time_stop');
    assert.equal(exitHitReason(position, 0.45, 1.25, due), null);
  });
});

describe('closedExitReason', () => {
  it('records market_close when settling, even if the stop also printed', () => {
    const position = lot({
      entryPriceUsd: 0.8,
      ...bakeStopRecipe(0.8, ENTRY, LIMITS),
    });
    assert.equal(
      closedExitReason(true, position, 0.5, -3.75, new Date(ENTRY)),
      'market_close',
    );
  });

  it('records flip when nothing in the seatbelt fired', () => {
    const position = lot({ ...bakeStopRecipe(0.4, ENTRY, LIMITS) });
    assert.equal(
      closedExitReason(false, position, 0.42, 0.5, AFTER_GRACE),
      'flip',
    );
  });

  it('ignores lots opened before stops existed (no baked recipe)', () => {
    assert.equal(exitHitReason(lot(), 0.2, -5, new Date(ENTRY)), null);
  });
});
