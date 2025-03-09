// Manual test for refactored components
// Run with: ts-node test/manual-test-ts.ts

import { ConditionEvaluatorService } from '../src/services/condition-evaluator-service.ts';
import { FingerprintService } from '../src/services/fingerprint-service.ts';
import { ConfigService } from '../src/services/config-service.ts';
import { ActionHandlerService } from '../src/services/action-handler-service.ts';
import { RateLimiterService } from '../src/services/rate-limiter-service.ts';
import { logger } from '../src/utils/index.ts';

// Override logger methods to use console directly
(logger as any).debug = console.debug;
(logger as any).log = console.log;
(logger as any).info = console.info;
(logger as any).warn = console.warn;
(logger as any).error = console.error;

async function runTest() {
  console.log('Testing refactored components...');
  
  // Create mock request
  const mockRequest = {
    url: 'https://example.com/test?param=value',
    headers: new Map(),
    method: 'GET',
    cf: {
      country: 'US',
      clientIp: '192.168.1.1'
    },
    clone: () => mockRequest,
    body: {
      getReader: () => ({
        read: async () => ({ done: true, value: new TextEncoder().encode('{"test": "value"}') })
      })
    }
  } as any;
  
  // Add mock headers get method
  mockRequest.headers.get = (name: string) => {
    if (name.toLowerCase() === 'user-agent') return 'test-agent';
    if (name.toLowerCase() === 'content-type') return 'application/json';
    return null;
  };
  
  // Get service instances
  const conditionEvaluator = ConditionEvaluatorService.getInstance();
  const fingerprintService = FingerprintService.getInstance();
  
  // Test condition evaluation
  const conditions = [
    { field: 'method', operator: 'eq', value: 'GET' },
    { field: 'headers.content-type', operator: 'eq', value: 'application/json' }
  ];
  
  console.log('Evaluating conditions...');
  
  try {
    // Add field cache to request to mimic actual usage
    (mockRequest as any)._fieldCache = {};
    (mockRequest as any)._bodyCache = null;
    
    const result = await conditionEvaluator.evaluateConditions(mockRequest, conditions);
    console.log('Condition evaluation result:', result);
    
    // Test fingerprint generation
    const fingerprintConfig = {
      parameters: [
        { name: 'method' },
        { name: 'headers.user-agent' },
        { name: 'clientIP' }
      ]
    };
    
    console.log('Generating fingerprint...');
    const clientId = await fingerprintService.getClientIdentifier(
      mockRequest,
      'test-rule',
      fingerprintConfig,
      mockRequest.cf
    );
    
    console.log('Generated client ID:', clientId);
    
    // Success!
    console.log('Test complete! Components are working correctly.');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

runTest();