import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FingerprintService } from '../../src/services/fingerprint-service';
import { RATE_LIMIT } from '../../src/constants';
import * as utils from '../../src/utils';

describe('FingerprintService', () => {
  let fingerprintService: FingerprintService;
  let mockRequest: any;
  let mockCfData: any;

  beforeEach(() => {
    // Reset the singleton instance for each test
    (FingerprintService as any).instance = undefined;
    
    // Create a new instance
    fingerprintService = FingerprintService.getInstance();
    
    // Mock request
    mockRequest = {
      url: 'https://example.com/test?param=value',
      headers: new Map([
        ['user-agent', 'test-agent'],
        ['cookie', 'test-cookie=value']
      ]),
      method: 'GET',
      cf: {
        country: 'US',
        clientIp: '192.168.1.1'
      },
      clone: () => mockRequest
    };
    
    // Add mock headers get method
    mockRequest.headers.get = (name: string) => {
      if (name.toLowerCase() === 'user-agent') return 'test-agent';
      if (name.toLowerCase() === 'cookie') return 'test-cookie=value';
      return null;
    };
    
    // Mock CF data
    mockCfData = {
      country: 'US',
      clientIp: '192.168.1.1'
    };
    
    // Mock console methods
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Mock hashValue function
    vi.spyOn(utils, 'hashValue').mockResolvedValue('mocked-hash-value');
    
    // Mock getRequestBody function
    vi.spyOn(utils, 'getRequestBody').mockResolvedValue('{"test":"value"}');
    
    // Mock getClientIP function
    vi.spyOn(utils, 'getClientIP').mockReturnValue('192.168.1.1');
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should be a singleton', () => {
    const instance1 = FingerprintService.getInstance();
    const instance2 = FingerprintService.getInstance();
    expect(instance1).toBe(instance2);
  });

  it('should return default identifier when no fingerprint config provided', async () => {
    const ruleName = 'test-rule';
    const identifier = await fingerprintService.getClientIdentifier(
      mockRequest,
      ruleName
    );
    
    expect(identifier).toBe(`${RATE_LIMIT.STORAGE_PREFIX}${ruleName}:default`);
  });

  it('should generate fingerprint based on headers', async () => {
    const ruleName = 'test-rule';
    const fingerprintConfig = {
      parameters: [
        { name: 'headers.user-agent' }
      ]
    };
    
    const identifier = await fingerprintService.getClientIdentifier(
      mockRequest,
      ruleName,
      fingerprintConfig,
      mockCfData
    );
    
    expect(utils.hashValue).toHaveBeenCalledWith('test-agent');
    expect(identifier).toBe(`${RATE_LIMIT.STORAGE_PREFIX}${ruleName}:fingerprint:mocked-hash-value`);
  });

  it('should generate fingerprint based on clientIP', async () => {
    const ruleName = 'test-rule';
    const fingerprintConfig = {
      parameters: [
        { name: 'clientIP' }
      ]
    };
    
    const identifier = await fingerprintService.getClientIdentifier(
      mockRequest,
      ruleName,
      fingerprintConfig,
      mockCfData
    );
    
    expect(utils.getClientIP).toHaveBeenCalledWith(mockRequest, mockCfData);
    expect(utils.hashValue).toHaveBeenCalledWith('192.168.1.1');
    expect(identifier).toBe(`${RATE_LIMIT.STORAGE_PREFIX}${ruleName}:fingerprint:mocked-hash-value`);
  });

  it('should generate fingerprint based on multiple parameters', async () => {
    const ruleName = 'test-rule';
    const fingerprintConfig = {
      parameters: [
        { name: 'clientIP' },
        { name: 'headers.user-agent' },
        { name: 'method' }
      ]
    };
    
    const identifier = await fingerprintService.getClientIdentifier(
      mockRequest,
      ruleName,
      fingerprintConfig,
      mockCfData
    );
    
    expect(utils.hashValue).toHaveBeenCalledWith('192.168.1.1|test-agent|GET');
    expect(identifier).toBe(`${RATE_LIMIT.STORAGE_PREFIX}${ruleName}:fingerprint:mocked-hash-value`);
  });

  it('should use fallback when error occurs during fingerprint generation', async () => {
    vi.spyOn(utils, 'hashValue').mockRejectedValue(new Error('Hash error'));
    
    // Mock the getClientIPFallback method to return null to test the default case
    vi.spyOn(utils, 'getClientIP').mockReturnValue(null);
    
    const ruleName = 'test-rule';
    const fingerprintConfig = {
      parameters: [
        { name: 'clientIP' }
      ]
    };
    
    const identifier = await fingerprintService.getClientIdentifier(
      mockRequest,
      ruleName,
      fingerprintConfig,
      mockCfData
    );
    
    // Should fall back to default since IP lookup also fails
    expect(identifier).toBe(`${RATE_LIMIT.STORAGE_PREFIX}${ruleName}:default`);
  });
});