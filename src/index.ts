import worker from './core/worker';
import { RateLimiterService } from './services';
import { DurableObjectState, Env } from './types';

// Define the RateLimiter Durable Object
export class RateLimiter {
  constructor(state: DurableObjectState, env: Env) {
    const rateLimiterService = RateLimiterService.getInstance();
    return rateLimiterService.createRateLimiterDurableObject(state, env);
  }
}

// Export the worker as the default export
export default worker;
