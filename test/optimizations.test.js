import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as configManager from '../src/config-manager.js';
import { evaluateConditions } from '../src/condition-evaluator.js';

describe('Performance Optimizations', () => {
  describe('Config Caching', () => {
    let env, ctx;
    
    beforeEach(() => {
      // Set up fake timers
      vi.useFakeTimers();
      
      // Reset the cached config
      vi.spyOn(configManager, 'getConfig').mockImplementation(() => {});
      
      // Mock environment
      env = {
        CONFIG_STORAGE: {
          idFromName: () => 'mock-id',
          get: () => ({
            fetch: async () => new Response(JSON.stringify({ rules: [{ name: 'test-rule' }] }), 
              { status: 200, headers: { 'Content-Type': 'application/json' } })
          })
        }
      };
      
      // Mock execution context
      ctx = {
        waitUntil: vi.fn()
      };
    });
    
    afterEach(() => {
      // Restore real timers
      vi.useRealTimers();
    });
    
    it('should use background refresh with stale cache', async () => {
      // Call getConfig twice to test caching behavior
      const result1 = await configManager.getConfig(env, ctx);
      // Fast-forward time to simulate TTL expiration
      vi.advanceTimersByTime(61 * 1000);
      const result2 = await configManager.getConfig(env, ctx);
      
      // Second call should trigger background refresh
      expect(ctx.waitUntil).toHaveBeenCalled();
    });
  });

  describe('Condition Evaluation', () => {
    let mockRequest;
    
    beforeEach(() => {
      // Create mock request with headers
      const headers = {
        'user-agent': 'test-agent',
        'cookie': 'test-cookie=value'
      };
      
      mockRequest = {
        url: 'https://example.com/test?param=value',
        headers: {
          get: (name) => headers[name.toLowerCase()]
        },
        method: 'GET',
        cf: {
          country: 'US',
          clientIp: '192.168.1.1'
        },
        clone: () => mockRequest
      };
      
      // Add mock body
      mockRequest.body = {
        getReader: () => ({
          read: async () => ({ done: true, value: new TextEncoder().encode('{"test": "value"}') })
        })
      };
    });
    
    it('should cache field values during condition evaluation', async () => {
      const conditions = [
        { field: 'headers.user-agent', operator: 'eq', value: 'test-agent' },
        { field: 'headers.user-agent', operator: 'contains', value: 'test' }
      ];
      
      // Spy on headers.get
      const headersSpy = vi.spyOn(mockRequest.headers, 'get');
      
      // Evaluate conditions
      const result = await evaluateConditions(mockRequest, conditions, 'and');
      
      // Should call headers.get only once despite having two conditions with the same field
      expect(headersSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
    });
    
    it('should optimize body parsing', async () => {
      // Mock body function
      const bodySpy = vi.spyOn(mockRequest.body, 'getReader');
      
      const conditions = [
        { field: 'body', operator: 'contains', value: 'test' },
        { field: 'body', operator: 'contains', value: 'value' }
      ];
      
      // Evaluate conditions
      await evaluateConditions(mockRequest, conditions, 'and');
      
      // Should read body only once
      expect(bodySpy).toHaveBeenCalledTimes(1);
    });
    
    it('should use regex caching for matches operator', async () => {
      const conditions = [
        { field: 'headers.user-agent', operator: 'matches', value: 'test.*' },
        { field: 'headers.user-agent', operator: 'matches', value: 'test.*' }
      ];
      
      // Spy on RegExp constructor using Object.prototype.constructor
      const originalRegExp = global.RegExp;
      let regExpCallCount = 0;
      global.RegExp = class extends originalRegExp {
        constructor(...args) {
          regExpCallCount++;
          return super(...args);
        }
      };
      
      // Evaluate conditions
      await evaluateConditions(mockRequest, conditions, 'and');
      
      // Should create RegExp only once despite having two conditions with the same pattern
      expect(regExpCallCount).toBe(1);
      
      // Restore original RegExp
      global.RegExp = originalRegExp;
    });
  });
});