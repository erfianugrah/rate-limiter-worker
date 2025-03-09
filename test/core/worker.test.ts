import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from '../../src/core/worker';
import { ConfigService } from '../../src/services/config-service';
import { ConditionEvaluatorService } from '../../src/services/condition-evaluator-service';
import { RateLimiterService } from '../../src/services/rate-limiter-service';
import { ActionHandlerService } from '../../src/services/action-handler-service';
import { RATE_LIMIT } from '../../src/constants';

// Mock all services
vi.mock('../../src/services/config-service');
vi.mock('../../src/services/condition-evaluator-service');
vi.mock('../../src/services/rate-limiter-service');
vi.mock('../../src/services/action-handler-service');

// Mock utils
vi.mock('../../src/utils', () => ({
  trackPerformance: vi.fn().mockImplementation((name, fn) => fn()),
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn()
  }
}));

describe('Worker', () => {
  let mockConfigService: any;
  let mockConditionEvaluator: any;
  let mockRateLimiterService: any;
  let mockActionHandler: any;
  let mockRequest: any;
  let mockEnv: any;
  let mockCtx: any;
  let mockConfig: any;
  let mockRule: any;
  let mockRateLimitInfo: any;
  let mockRateLimitResponse: any;

  beforeEach(() => {
    // Reset mocks
    vi.resetAllMocks();
    
    // Mock config
    mockConfig = {
      rules: [
        {
          name: 'test-rule',
          rateLimit: { limit: 100, period: 60 },
          initialMatch: {
            conditions: [{ field: 'method', operator: 'eq', value: 'GET' }],
            action: { type: 'rateLimit' }
          }
        }
      ]
    };
    
    // Mock rule
    mockRule = {
      name: 'test-rule',
      rateLimit: { limit: 100, period: 60 },
      initialMatch: {
        conditions: [{ field: 'method', operator: 'eq', value: 'GET' }],
        action: { type: 'rateLimit' }
      }
    };
    
    // Mock rate limit info
    mockRateLimitInfo = {
      allowed: true,
      limit: 100,
      remaining: 99,
      reset: Math.floor(Date.now() / 1000) + 60,
      resetFormatted: new Date(Date.now() + 60000).toUTCString(),
      period: 60,
      action: { type: 'rateLimit' },
      clientIdentifier: 'rate_limit:test-rule:fingerprint:abcdef'
    };
    
    // Mock rate limit response
    mockRateLimitResponse = new Response(JSON.stringify(mockRateLimitInfo), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        [RATE_LIMIT.HEADERS.LIMIT]: '100',
        [RATE_LIMIT.HEADERS.REMAINING]: '99',
        [RATE_LIMIT.HEADERS.RESET]: Math.floor(Date.now() / 1000 + 60).toString(),
        [RATE_LIMIT.HEADERS.PERIOD]: '60'
      }
    });
    
    // Mock services
    mockConfigService = {
      getConfig: vi.fn().mockResolvedValue(mockConfig)
    };
    
    mockConditionEvaluator = {
      findMatchingRule: vi.fn().mockResolvedValue(mockRule)
    };
    
    mockRateLimiterService = {
      handleRateLimit: vi.fn().mockResolvedValue({
        rateLimitInfo: mockRateLimitInfo,
        rateLimitResponse: mockRateLimitResponse
      })
    };
    
    mockActionHandler = {
      handleAction: vi.fn().mockResolvedValue(new Response('Action applied', { status: 429 })),
      applyRateLimitHeaders: vi.fn().mockImplementation((response) => {
        response.headers.set(RATE_LIMIT.HEADERS.LIMIT, '100');
        response.headers.set(RATE_LIMIT.HEADERS.REMAINING, '99');
        return response;
      })
    };
    
    // Set up service mocks
    vi.mocked(ConfigService.getInstance).mockReturnValue(mockConfigService as any);
    vi.mocked(ConditionEvaluatorService.getInstance).mockReturnValue(mockConditionEvaluator as any);
    vi.mocked(RateLimiterService.getInstance).mockReturnValue(mockRateLimiterService as any);
    vi.mocked(ActionHandlerService.getInstance).mockReturnValue(mockActionHandler as any);
    
    // Mock request
    mockRequest = {
      url: 'https://example.com/test',
      headers: new Map(),
      method: 'GET',
      clone: () => mockRequest
    };
    
    // Add mock headers get method
    mockRequest.headers.get = (name: string) => {
      if (name === RATE_LIMIT.HEADERS.SERVE_PAGE) return null;
      return null;
    };
    
    // Mock environment
    mockEnv = {
      RATE_LIMIT_INFO_PATH: '/_ratelimit',
      RATE_LIMITER: {},
      CONFIG_STORAGE: {}
    };
    
    // Mock execution context
    mockCtx = {
      waitUntil: vi.fn()
    };
    
    // Mock global fetch
    global.fetch = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }));
    
    // Mock console methods
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should pass through requests when no rules are configured', async () => {
    // Override config to be empty
    mockConfigService.getConfig.mockResolvedValue({ rules: [] });
    
    const response = await worker.fetch(mockRequest, mockEnv, mockCtx);
    
    expect(mockConfigService.getConfig).toHaveBeenCalledWith(mockEnv, mockCtx);
    expect(mockConditionEvaluator.findMatchingRule).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(mockRequest);
    expect(await response.text()).toBe('OK');
  });

  it('should pass through requests when no matching rule is found', async () => {
    // Override to return null for no matching rule
    mockConditionEvaluator.findMatchingRule.mockResolvedValue(null);
    
    const response = await worker.fetch(mockRequest, mockEnv, mockCtx);
    
    expect(mockConfigService.getConfig).toHaveBeenCalledWith(mockEnv, mockCtx);
    expect(mockConditionEvaluator.findMatchingRule).toHaveBeenCalledWith(mockRequest, mockConfig);
    expect(global.fetch).toHaveBeenCalledWith(mockRequest);
    expect(await response.text()).toBe('OK');
  });

  it('should apply rate limiting when rule matches and request is allowed', async () => {
    const response = await worker.fetch(mockRequest, mockEnv, mockCtx);
    
    expect(mockConfigService.getConfig).toHaveBeenCalledWith(mockEnv, mockCtx);
    expect(mockConditionEvaluator.findMatchingRule).toHaveBeenCalledWith(mockRequest, mockConfig);
    expect(mockRateLimiterService.handleRateLimit).toHaveBeenCalledWith(
      mockRequest,
      mockEnv,
      mockRule
    );
    
    // Should fetch from origin since allowed
    expect(global.fetch).toHaveBeenCalledWith(mockRequest);
    
    // Should apply rate limit headers
    expect(mockActionHandler.applyRateLimitHeaders).toHaveBeenCalled();
  });

  it('should apply rate limit action when rule matches and request is not allowed', async () => {
    // Override rate limit info to not be allowed
    mockRateLimitInfo.allowed = false;
    mockRateLimiterService.handleRateLimit.mockResolvedValue({
      rateLimitInfo: mockRateLimitInfo,
      rateLimitResponse: mockRateLimitResponse
    });
    
    const response = await worker.fetch(mockRequest, mockEnv, mockCtx);
    
    expect(mockConfigService.getConfig).toHaveBeenCalledWith(mockEnv, mockCtx);
    expect(mockConditionEvaluator.findMatchingRule).toHaveBeenCalledWith(mockRequest, mockConfig);
    expect(mockRateLimiterService.handleRateLimit).toHaveBeenCalledWith(
      mockRequest,
      mockEnv,
      mockRule
    );
    
    // Should not fetch from origin since not allowed
    expect(global.fetch).not.toHaveBeenCalled();
    
    // Should apply action handler
    expect(mockActionHandler.handleAction).toHaveBeenCalledWith(
      mockEnv,
      mockRequest,
      mockRateLimitInfo,
      mockRule
    );
    
    // Should apply rate limit headers
    expect(mockActionHandler.applyRateLimitHeaders).toHaveBeenCalled();
  });

  it('should serve rate limit page when header is set', async () => {
    // Override request to request rate limit page
    mockRequest.headers.get = (name: string) => {
      if (name === RATE_LIMIT.HEADERS.SERVE_PAGE) return 'true';
      if (name === RATE_LIMIT.HEADERS.INFO) return JSON.stringify({
        retryAfter: 60
      });
      return null;
    };
    
    const response = await worker.fetch(mockRequest, mockEnv, mockCtx);
    
    // Should not fetch config or find rules
    expect(mockConfigService.getConfig).not.toHaveBeenCalled();
    expect(mockConditionEvaluator.findMatchingRule).not.toHaveBeenCalled();
    
    // Should return HTML response
    expect(response.headers.get('Content-Type')).toBe('text/html');
    const body = await response.text();
    expect(body).toContain('<html>');
    expect(body).toContain('Rate Limit Exceeded');
  });

  it('should handle rate limit info path', async () => {
    // Override request URL to be rate limit info path
    Object.defineProperty(mockRequest, 'url', {
      value: 'https://example.com/_ratelimit'
    });
    
    const response = await worker.fetch(mockRequest, mockEnv, mockCtx);
    
    expect(mockConfigService.getConfig).toHaveBeenCalledWith(mockEnv, mockCtx);
    expect(mockConditionEvaluator.findMatchingRule).toHaveBeenCalledWith(mockRequest, mockConfig);
    expect(mockRateLimiterService.handleRateLimit).toHaveBeenCalledWith(
      mockRequest,
      mockEnv,
      mockRule
    );
    
    // Should return JSON response
    expect(response.headers.get('Content-Type')).toBe('application/json');
  });

  it('should pass through on error', async () => {
    // Make config service throw an error
    mockConfigService.getConfig.mockRejectedValue(new Error('Test error'));
    
    const response = await worker.fetch(mockRequest, mockEnv, mockCtx);
    
    // Should pass through to origin
    expect(global.fetch).toHaveBeenCalledWith(mockRequest);
    expect(await response.text()).toBe('OK');
  });

  it('should handle queue messages', async () => {
    const batch = {
      messages: [
        {
          body: { type: 'config_update' },
          ack: vi.fn().mockResolvedValue(undefined)
        },
        {
          body: { type: 'unknown' },
          ack: vi.fn().mockResolvedValue(undefined)
        }
      ]
    };
    
    await worker.queue(batch, mockEnv, mockCtx);
    
    // Should try to fetch config for config_update message
    expect(mockConfigService.getConfig).toHaveBeenCalledWith(mockEnv, mockCtx);
    
    // Should ack both messages
    expect(batch.messages[0].ack).toHaveBeenCalled();
    expect(batch.messages[1].ack).toHaveBeenCalled();
  });
});