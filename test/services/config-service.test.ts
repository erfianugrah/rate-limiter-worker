import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '../../src/services/config-service';
import { CONFIG } from '../../src/constants';

describe('ConfigService', () => {
  let configService: ConfigService;
  let mockEnv: any;
  let mockCtx: any;
  let mockConfigStorage: any;
  let mockFetch: any;

  beforeEach(() => {
    // Reset the singleton instance for each test
    // This is a hack to access the private static instance
    (ConfigService as any).instance = undefined;
    
    // Create a new instance
    configService = ConfigService.getInstance();
    
    // Mock fetch response
    mockFetch = vi.fn().mockResolvedValue(new Response(
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
    ));
    
    // Mock ConfigStorage durable object
    mockConfigStorage = {
      fetch: mockFetch
    };
    
    // Mock Env
    mockEnv = {
      CONFIG_STORAGE: {
        idFromName: vi.fn().mockReturnValue('mock-id'),
        get: vi.fn().mockReturnValue(mockConfigStorage)
      }
    };
    
    // Mock execution context
    mockCtx = {
      waitUntil: vi.fn()
    };
    
    // Reset some private properties (hack to access private properties)
    (configService as any).cachedConfig = null;
    (configService as any).lastConfigFetch = 0;
    (configService as any).isRefreshing = false;
    
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
    const instance1 = ConfigService.getInstance();
    const instance2 = ConfigService.getInstance();
    expect(instance1).toBe(instance2);
  });

  it('should fetch config when cache is empty', async () => {
    const config = await configService.getConfig(mockEnv);
    
    expect(mockEnv.CONFIG_STORAGE.idFromName).toHaveBeenCalledWith('global');
    expect(mockEnv.CONFIG_STORAGE.get).toHaveBeenCalledWith('mock-id');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: CONFIG.ENDPOINT
      })
    );
    
    expect(config).toEqual({
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
    });
  });

  it('should use cached config when available', async () => {
    // First call to populate cache
    await configService.getConfig(mockEnv);
    mockFetch.mockClear();
    
    // Second call should use cache
    const config = await configService.getConfig(mockEnv);
    
    expect(mockFetch).not.toHaveBeenCalled();
    expect(config).toEqual({
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
    });
  });

  it('should refresh in background when cache is stale', async () => {
    // First call to populate cache
    await configService.getConfig(mockEnv);
    
    // Simulate cache expiration
    (configService as any).lastConfigFetch = Date.now() - (CONFIG.CACHE_TTL + 1000);
    
    // Second call with context should trigger background refresh
    await configService.getConfig(mockEnv, mockCtx);
    
    expect(mockCtx.waitUntil).toHaveBeenCalled();
  });

  it('should validate rule structure correctly', () => {
    // Valid rule
    const validRule = {
      name: 'test-rule',
      rateLimit: { limit: 100, period: 60 },
      initialMatch: {
        conditions: [],
        action: { type: 'log' }
      }
    };
    
    expect(configService.isValidRuleStructure(validRule as any)).toBe(true);
    
    // Invalid rule - missing initialMatch
    const invalidRule1 = {
      name: 'test-rule',
      rateLimit: { limit: 100, period: 60 }
    };
    
    expect(configService.isValidRuleStructure(invalidRule1 as any)).toBe(false);
    
    // Invalid rule - elseIfActions without elseAction
    const invalidRule2 = {
      name: 'test-rule',
      rateLimit: { limit: 100, period: 60 },
      initialMatch: {
        conditions: [],
        action: { type: 'log' }
      },
      elseIfActions: [
        {
          conditions: [],
          action: { type: 'block' }
        }
      ]
    };
    
    expect(configService.isValidRuleStructure(invalidRule2 as any)).toBe(false);
  });
});