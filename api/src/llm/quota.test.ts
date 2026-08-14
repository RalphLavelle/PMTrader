/**
 * LLM quota backoff tests.
 *
 * The real Ollama Cloud error looks like:
 * "429 you (ralphlavelle) have reached your session usage limit"
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  clearLlmBackoff,
  isLlmBackingOff,
  isLlmQuotaError,
  llmBackoffUntil,
  noteLlmFailure,
} from './quota.js';

afterEach(() => {
  clearLlmBackoff();
});

describe('isLlmQuotaError', () => {
  it('matches the Ollama Cloud session usage limit message', () => {
    const error = new Error(
      '429 you (ralphlavelle) have reached your session usage limit',
    );
    assert.equal(isLlmQuotaError(error), true);
  });

  it('matches a numeric HTTP 429 on the error object', () => {
    assert.equal(isLlmQuotaError({ status: 429, message: 'Too Many Requests' }), true);
  });

  it('ignores ordinary failures', () => {
    assert.equal(isLlmQuotaError(new Error('Market not found')), false);
    assert.equal(isLlmQuotaError({ status: 500 }), false);
  });
});

describe('LLM backoff window', () => {
  it('is inactive until a quota failure is noted', () => {
    assert.equal(isLlmBackingOff(), false);
    assert.equal(llmBackoffUntil(), null);
  });

  it('stays on until the window elapses', () => {
    const t0 = 1_000_000;
    assert.equal(noteLlmFailure(new Error('429 session usage limit'), t0), true);
    assert.equal(isLlmBackingOff(t0), true);

    const until = llmBackoffUntil(t0);
    assert.ok(until);
    assert.equal(isLlmBackingOff(until.getTime() - 1), true);
    assert.equal(isLlmBackingOff(until.getTime()), false);
  });

  it('does not start a backoff for a non-quota error', () => {
    assert.equal(noteLlmFailure(new Error('timeout')), false);
    assert.equal(isLlmBackingOff(), false);
  });
});
