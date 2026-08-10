import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JupiterRateLimiter } from './rate-limiter.js';

describe('JupiterRateLimiter', () => {
  it('serialises calls with at least minIntervalMs between starts', async () => {
    const limiter = new JupiterRateLimiter(50, 0, 0);
    const starts: number[] = [];

    await Promise.all([
      limiter.run(async () => {
        starts.push(Date.now());
      }),
      limiter.run(async () => {
        starts.push(Date.now());
      }),
      limiter.run(async () => {
        starts.push(Date.now());
      }),
    ]);

    assert.equal(starts.length, 3);
    for (let i = 1; i < starts.length; i += 1) {
      assert.ok(starts[i]! - starts[i - 1]! >= 45, `gap ${i} too short`);
    }
  });

  it('retries once on HTTP 429 then succeeds', async () => {
    const limiter = new JupiterRateLimiter(0, 1, 10);
    let attempts = 0;

    const value = await limiter.run(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw { status: 429 };
      }
      return 'ok';
    });

    assert.equal(value, 'ok');
    assert.equal(attempts, 2);
  });

  it('propagates non-429 errors without retry', async () => {
    const limiter = new JupiterRateLimiter(0, 2, 10);
    let attempts = 0;

    await assert.rejects(
      () =>
        limiter.run(async () => {
          attempts += 1;
          throw { status: 500 };
        }),
      (error: { status: number }) => error.status === 500,
    );

    assert.equal(attempts, 1);
  });
});
