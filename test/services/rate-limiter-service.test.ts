import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiterService } from '../../src/services/rate-limiter-service';
import { FingerprintService } from '../../src/services/fingerprint-service';
import { RATE_LIMIT } from '../../src/constants';

describe('RateLimiterService', () => {
  let rateLimiterService: RateLimiterService;
  let mockRequest: any;
  let mockEnv: any;
  let mockRule: any;
  let mockStorage: any;
  let mockDurableObject: any;
  let mockFingerprintService: any;

  beforeEach(() => {
    // Reset the singleton instance for each test
    (RateLimiterService as any).instance = undefined;
    (FingerprintService as any).instance = undefined;
    
    // Mock FingerprintService
    mockFingerprintService = {
      getClientIdentifier: vi.fn().mockResolvedValue('rate_limit:test-rule:fingerprint:abcdef')
    };
    vi.spyOn(FingerprintService, 'getInstance').mockReturnValue(mockFingerprintService);
    
    // Create a new instance
    rateLimiterService = RateLimiterService.getInstance();
    
    // Mock storage
    mockStorage = {
      get: vi.fn().mockResolvedValue(JSON.stringify([Date.now() - 30000, Date.now() - 20000])),
      put: vi.fn().mockResolvedValue(undefined)
    };
    
    // Mock request
    mockRequest = {
      url: 'https://example.com/test',
      headers: new Map(),
      method: 'GET',
      clone: () => mockRequest
    };
    
    // Add mock headers get method
    mockRequest.headers.get = (name: string) => {
      if (name.toLowerCase() === 'x-rate-limit-config') {
        return JSON.stringify({
          name: 'test-rule',
          rateLimit: { limit: 5, period: 60 },
          initialMatch: {
            conditions: [{ field: 'method', operator: 'eq', value: 'GET' }],
            action: { type: 'rateLimit' }
          }
        });
      }
      return null;
    };
    
    // Mock rule
    mockRule = {
      name: 'test-rule',
      rateLimit: { limit: 5, period: 60 },
      initialMatch: {
        conditions: [{ field: 'method', operator: 'eq', value: 'GET' }],
        action: { type: 'rateLimit' }
      }
    };
    
    // Mock Durable Object
    mockDurableObject = {
      fetch: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            allowed: true,
            limit: 5,
            remaining: 3,
            reset: Math.floor(Date.now() / 1000) + 60,
            resetFormatted: new Date(Date.now() + 60000).toUTCString(),
            period: 60,
            action: { type: 'rateLimit' },
            clientIdentifier: 'rate_limit:test-rule:fingerprint:abcdef'
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              [RATE_LIMIT.HEADERS.LIMIT]: '5',
              [RATE_LIMIT.HEADERS.REMAINING]: '3',
              [RATE_LIMIT.HEADERS.RESET]: Math.floor(Date.now() / 1000 + 60).toString(),
              [RATE_LIMIT.HEADERS.PERIOD]: '60'
            }
          }
        )
      )
    };
    
    // Mock environment
    mockEnv = {
      RATE_LIMITER: {
        idFromName: vi.fn().mockReturnValue('mock-rate-limiter-id'),
        get: vi.fn().mockReturnValue(mockDurableObject)
      }
    };
    
    // Mock console methods
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should be a singleton', () => {
    const instance1 = RateLimiterService.getInstance();
    const instance2 = RateLimiterService.getInstance();
    expect(instance1).toBe(instance2);
  });

  it('should handle rate limiting for a request', async () => {
    const result = await rateLimiterService.handleRateLimit(
      mockRequest,
      mockEnv,
      mockRule
    );
    
    // Verify Durable Object was accessed correctly
    expect(mockEnv.RATE_LIMITER.idFromName).toHaveBeenCalledWith('global');
    expect(mockEnv.RATE_LIMITER.get).toHaveBeenCalledWith('mock-rate-limiter-id');
    
    // Verify correct headers were set on the request to the Durable Object
    expect(mockDurableObject.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          get: expect.any(Function)
        })
      })
    );
    
    // Verify the result contains the expected properties
    expect(result).toHaveProperty('rateLimitInfo');
    expect(result).toHaveProperty('rateLimitResponse');
    expect(result.rateLimitInfo).toHaveProperty('allowed', true);
    expect(result.rateLimitInfo).toHaveProperty('remaining', 3);
  });

  it('should check rate limits correctly', async () => {
    const clientIdentifier = 'rate_limit:test-rule:fingerprint:abcdef';
    const now = Date.now();
    
    // Test when under the limit
    const result1 = await rateLimiterService.checkRateLimit(
      clientIdentifier,
      mockRule,
      mockStorage,
      now
    );
    
    expect(result1.isAllowed).toBe(true);
    expect(result1.remaining).toBe(2); // 5 limit - 3 requests (2 existing + 1 current)
    
    // Verify storage interactions
    expect(mockStorage.get).toHaveBeenCalledWith(clientIdentifier);
    expect(mockStorage.put).toHaveBeenCalledWith(
      clientIdentifier,
      expect.any(String)
    );
    
    // Test when over the limit
    mockStorage.get.mockResolvedValue(JSON.stringify([
      now - 50000, now - 40000, now - 30000, now - 20000, now - 10000
    ]));
    
    const result2 = await rateLimiterService.checkRateLimit(
      clientIdentifier,
      mockRule,
      mockStorage,
      now
    );
    
    expect(result2.isAllowed).toBe(false);
    expect(result2.remaining).toBe(0);
  });

  it('should create proper rate limit response', () => {
    const now = Date.now();
    const resetTime = now + 60000;
    
    // Test allowed response
    const response1 = rateLimiterService.createRateLimitResponse(
      true,
      mockRule,
      4,
      resetTime,
      60,
      'rate_limit:test-rule:fingerprint:abcdef',
      { type: 'rateLimit' }
    );
    
    expect(response1.status).toBe(200);
    expect(response1.headers.get('Content-Type')).toBe('application/json');
    expect(response1.headers.get(RATE_LIMIT.HEADERS.LIMIT)).toBe('5');
    expect(response1.headers.get(RATE_LIMIT.HEADERS.REMAINING)).toBe('4');
    expect(response1.headers.get(RATE_LIMIT.HEADERS.RESET)).toBe(Math.floor(resetTime / 1000).toString());
    
    // Test denied response
    const response2 = rateLimiterService.createRateLimitResponse(
      false,
      mockRule,
      0,
      resetTime,
      60,
      'rate_limit:test-rule:fingerprint:abcdef',
      { type: 'rateLimit' }
    );
    
    expect(response2.status).toBe(429);
    expect(response2.headers.get('Retry-After')).toBe('60');
    
    // Parse JSON body to check contents
    return response2.json().then(body => {
      expect(body.allowed).toBe(false);
      expect(body.remaining).toBe(0);
      expect(body.retryAfter).toBe(60);
    });
  });
});