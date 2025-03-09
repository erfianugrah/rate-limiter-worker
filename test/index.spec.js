import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src';

describe('Rate Limiter Worker', () => {
  let mockRequest;
  let mockEnv;
  let mockCtx;

  beforeEach(() => {
    // Create a mock request
    mockRequest = new Request('http://example.com');
    
    // Mock Cloudflare environment
    mockEnv = {
      RATE_LIMITER: {
        idFromName: () => 'mock-rate-limiter-id',
        get: () => ({
          fetch: vi.fn().mockResolvedValue(new Response(
            JSON.stringify({ allowed: true, limit: 100, remaining: 99 }),
            { 
              status: 200,
              headers: { 
                'Content-Type': 'application/json',
                'X-Rate-Limit-Limit': '100',
                'X-Rate-Limit-Remaining': '99'
              } 
            }
          ))
        })
      },
      CONFIG_STORAGE: {
        idFromName: () => 'mock-config-id',
        get: () => ({
          fetch: vi.fn().mockResolvedValue(new Response(
            JSON.stringify({ 
              rules: [
                {
                  name: 'test-rule',
                  rateLimit: { limit: 100, period: 60 },
                  initialMatch: {
                    conditions: [],
                    action: { type: 'log' }
                  }
                }
              ] 
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          ))
        })
      },
      RATE_LIMIT_INFO_PATH: '/_ratelimit',
      ENVIRONMENT: 'test'
    };
    
    // Mock execution context
    mockCtx = createExecutionContext();
  });

  it('passes through requests when no matching rules', async () => {
    // Override CONFIG_STORAGE to return empty rules
    mockEnv.CONFIG_STORAGE.get = () => ({
      fetch: vi.fn().mockResolvedValue(new Response(
        JSON.stringify({ rules: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ))
    });
    
    // Mock global fetch
    global.fetch = vi.fn().mockResolvedValue(new Response('Passed through', { status: 200 }));
    
    const response = await worker.fetch(mockRequest, mockEnv, mockCtx);
    await waitOnExecutionContext(mockCtx);
    
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Passed through');
  });

  // Add more tests here for different scenarios
});
