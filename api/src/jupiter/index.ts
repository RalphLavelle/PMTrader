import { JupiterClient } from './client.js';

/** Shared Jupiter client instance used by route handlers. */
export const jupiter = new JupiterClient();

export { jupiterRateLimiter } from './client.js';
export { JupiterRateLimiter } from './rate-limiter.js';
