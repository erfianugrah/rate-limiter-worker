import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConditionEvaluatorService } from '../../src/services/condition-evaluator-service';
import { ConfigService } from '../../src/services/config-service';

// Mock the utils modules
vi.mock('../../src/utils/request', () => ({
  getRequestBody: vi.fn().mockResolvedValue('{"test":"value"}'),
  getNestedValue: vi.fn().mockImplementation((obj, path) => {
    if (path === 'hostname') return 'example.com';
    if (path === 'pathname') return '/test';
    if (path === 'searchParams.get("param")') return 'value';
    return undefined;
  }),
  isIPInCIDR: vi.fn().mockReturnValue(false),
  getClientIP: vi.fn().mockReturnValue('192.168.1.1'),
  parseCookies: vi.fn().mockReturnValue({})
}));

// Import after mocking
import * as requestUtils from '../../src/utils/request';

describe('ConditionEvaluatorService', () => {
  let conditionEvaluatorService: ConditionEvaluatorService;
  let mockConfigService: any;
  let mockRequest: any;
  let mockConfig: any;

  beforeEach(() => {
    // Reset the singleton instance for each test
    (ConditionEvaluatorService as any).instance = undefined;
    (ConfigService as any).instance = undefined;
    
    // Mock ConfigService
    mockConfigService = {
      isValidRuleStructure: vi.fn().mockReturnValue(true)
    };
    vi.spyOn(ConfigService, 'getInstance').mockReturnValue(mockConfigService);
    
    // Create a new instance
    conditionEvaluatorService = ConditionEvaluatorService.getInstance();
    
    // Mock request
    mockRequest = {
      url: 'https://example.com/test?param=value',
      headers: new Map(),
      method: 'GET',
      cf: {
        country: 'US',
        clientIp: '192.168.1.1'
      },
      _fieldCache: {},
      _bodyCache: null,
      clone: () => mockRequest
    };
    
    // Add mock headers get method
    mockRequest.headers.get = (name: string) => {
      if (name.toLowerCase() === 'user-agent') return 'test-agent';
      if (name.toLowerCase() === 'content-type') return 'application/json';
      return null;
    };
    
    // Mock config
    mockConfig = {
      rules: [
        {
          name: 'test-rule',
          rateLimit: { limit: 100, period: 60 },
          initialMatch: {
            conditions: [
              { field: 'method', operator: 'eq', value: 'GET' }
            ],
            action: { type: 'log' }
          }
        },
        {
          name: 'test-rule-2',
          rateLimit: { limit: 50, period: 30 },
          initialMatch: {
            conditions: [
              { field: 'headers.content-type', operator: 'eq', value: 'application/json' }
            ],
            action: { type: 'block' }
          }
        }
      ]
    };
    
    // Reset mocks
    vi.clearAllMocks();
    
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
    const instance1 = ConditionEvaluatorService.getInstance();
    const instance2 = ConditionEvaluatorService.getInstance();
    expect(instance1).toBe(instance2);
  });

  it('should evaluate simple conditions correctly', async () => {
    const conditions = [
      { field: 'method', operator: 'eq', value: 'GET' }
    ];
    
    const result = await conditionEvaluatorService.evaluateConditions(mockRequest, conditions);
    expect(result).toBe(true);
  });

  it('should evaluate negative conditions correctly', async () => {
    const conditions = [
      { field: 'method', operator: 'eq', value: 'POST' }
    ];
    
    const result = await conditionEvaluatorService.evaluateConditions(mockRequest, conditions);
    expect(result).toBe(false);
  });

  it('should evaluate multiple conditions with AND logic', async () => {
    const conditions = [
      { field: 'method', operator: 'eq', value: 'GET' },
      { field: 'headers.content-type', operator: 'eq', value: 'application/json' }
    ];
    
    const result = await conditionEvaluatorService.evaluateConditions(mockRequest, conditions, 'and');
    expect(result).toBe(true);
  });

  it('should evaluate multiple conditions with OR logic', async () => {
    const conditions = [
      { field: 'method', operator: 'eq', value: 'POST' }, // false
      { field: 'headers.content-type', operator: 'eq', value: 'application/json' } // true
    ];
    
    const result = await conditionEvaluatorService.evaluateConditions(mockRequest, conditions, 'or');
    expect(result).toBe(true);
  });

  it('should handle nested condition groups', async () => {
    const conditions = [
      {
        conditions: [
          { field: 'method', operator: 'eq', value: 'GET' },
          { field: 'headers.content-type', operator: 'eq', value: 'application/json' }
        ]
      }
    ];
    
    const result = await conditionEvaluatorService.evaluateConditions(mockRequest, conditions);
    expect(result).toBe(true);
  });

  it('should use field caching for repeated fields', async () => {
    const conditions = [
      { field: 'method', operator: 'eq', value: 'GET' },
      { field: 'method', operator: 'ne', value: 'POST' }
    ];
    
    // Create spy to track field extraction
    const extractFieldValueSpy = vi.spyOn(conditionEvaluatorService as any, 'extractFieldValue');
    
    await conditionEvaluatorService.evaluateConditions(mockRequest, conditions);
    
    // Should only call extractFieldValue once for 'method'
    expect(extractFieldValueSpy).toHaveBeenCalledTimes(1);
    expect(extractFieldValueSpy).toHaveBeenCalledWith(mockRequest, 'method');
  });

  it('should find a matching rule based on conditions', async () => {
    // Mock evaluateConditions to return true only for the first rule
    vi.spyOn(conditionEvaluatorService, 'evaluateConditions')
      .mockImplementationOnce(async () => true)  // First rule (test-rule) matches
      .mockImplementationOnce(async () => false); // Second rule doesn't match
      
    const matchingRule = await conditionEvaluatorService.findMatchingRule(mockRequest, mockConfig);
    
    expect(matchingRule).not.toBeNull();
    expect(matchingRule?.name).toBe('test-rule');
  });

  it('should return null when no rules match', async () => {
    // Override request method to make it not match any rules
    Object.defineProperty(mockRequest, 'method', { value: 'POST' });
    mockRequest.headers.get = (name: string) => {
      if (name.toLowerCase() === 'content-type') return 'text/plain';
      return null;
    };
    
    const matchingRule = await conditionEvaluatorService.findMatchingRule(mockRequest, mockConfig);
    expect(matchingRule).toBeNull();
  });
});