import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as requestUtils from '../../src/utils/request';

describe('Request Utils', () => {
  let mockRequest: any;
  let mockCfData: any;

  beforeEach(() => {
    // Mock request
    mockRequest = {
      url: 'https://example.com/test?param=value',
      headers: new Map(),
      method: 'GET',
      clone: () => mockRequest,
      body: {
        getReader: vi.fn().mockImplementation(() => ({
          read: vi.fn().mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('{"test":"value"}')
          }).mockResolvedValueOnce({
            done: true
          })
        }))
      }
    };
    
    // Add mock headers get method
    mockRequest.headers.get = (name: string) => {
      if (name.toLowerCase() === 'user-agent') return 'test-agent';
      if (name.toLowerCase() === 'cf-connecting-ip') return '203.0.113.1';
      if (name.toLowerCase() === 'cookie') return 'test=value; another=123';
      return null;
    };
    
    // Mock CF data
    mockCfData = {
      clientIp: '203.0.113.2',
      country: 'US'
    };
  });

  it('should get client IP from various sources', () => {
    // From cf-connecting-ip header
    expect(requestUtils.getClientIP(mockRequest, mockCfData)).toBe('203.0.113.1');
    
    // From CF data
    mockRequest.headers.get = (name: string) => null;
    expect(requestUtils.getClientIP(mockRequest, mockCfData)).toBe('203.0.113.2');
    
    // From x-forwarded-for header
    mockRequest.headers.get = (name: string) => {
      if (name.toLowerCase() === 'x-forwarded-for') return '192.0.2.1, 198.51.100.2';
      return null;
    };
    expect(requestUtils.getClientIP(mockRequest, mockCfData)).toBe('192.0.2.1');
    
    // Unknown when nothing available
    mockRequest.headers.get = (name: string) => null;
    mockCfData = {};
    expect(requestUtils.getClientIP(mockRequest, mockCfData)).toBe('unknown');
  });

  it('should parse cookies correctly', () => {
    const cookies = requestUtils.parseCookies('test=value; another=123');
    expect(cookies).toEqual({
      test: 'value',
      another: '123'
    });
    
    // Handle empty/null cookie string
    expect(requestUtils.parseCookies('')).toEqual({});
    expect(requestUtils.parseCookies(null)).toEqual({});
  });

  it('should get nested values from objects', () => {
    const obj = {
      user: {
        profile: {
          name: 'John',
          address: {
            city: 'New York'
          }
        },
        settings: {
          theme: 'dark'
        }
      }
    };
    
    expect(requestUtils.getNestedValue(obj, 'user.profile.name')).toBe('John');
    expect(requestUtils.getNestedValue(obj, 'user.profile.address.city')).toBe('New York');
    expect(requestUtils.getNestedValue(obj, 'user.settings.theme')).toBe('dark');
    
    // Handle missing paths
    expect(requestUtils.getNestedValue(obj, 'user.profile.age')).toBeUndefined();
    expect(requestUtils.getNestedValue(obj, 'user.address')).toBeUndefined();
  });

  it('should read request body with size limits', async () => {
    const body = await requestUtils.getRequestBody(mockRequest);
    expect(body).toBe('{"test":"value"}');
    expect(mockRequest.body.getReader).toHaveBeenCalled();
    
    // Test with large body that gets truncated
    const largeBody = 'a'.repeat(600000);
    mockRequest.body.getReader = vi.fn().mockImplementation(() => ({
      read: vi.fn().mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode(largeBody)
      }).mockResolvedValueOnce({
        done: true
      })
    }));
    
    const truncatedBody = await requestUtils.getRequestBody(mockRequest);
    expect(truncatedBody.length).toBeLessThan(largeBody.length);
    
    // Test error handling
    mockRequest.body.getReader = vi.fn().mockImplementation(() => {
      throw new Error('Test error');
    });
    
    const emptyBody = await requestUtils.getRequestBody(mockRequest);
    expect(emptyBody).toBe('');
  });

  it('should check if IP is in CIDR range', () => {
    // IP in range
    expect(requestUtils.isIPInCIDR('192.168.1.5', '192.168.1.0/24')).toBe(true);
    
    // IP not in range
    expect(requestUtils.isIPInCIDR('10.0.0.1', '192.168.1.0/24')).toBe(false);
    
    // Edge cases
    expect(requestUtils.isIPInCIDR('192.168.1.1', '192.168.1.1/32')).toBe(true);
    expect(requestUtils.isIPInCIDR('192.168.1.2', '192.168.1.1/32')).toBe(false);
  });
});