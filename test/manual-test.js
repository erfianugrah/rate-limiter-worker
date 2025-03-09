// Manual test to validate performance improvements
// Run with: NODE_OPTIONS=--experimental-vm-modules node test/manual-test.js

import { ConditionEvaluatorService } from '../src/services/condition-evaluator-service.js';

async function runTest() {
  console.log('Testing performance optimizations...');
  
  // Mock request object
  const mockRequest = {
    url: 'https://example.com/test?param=value',
    headers: {
      get: (name) => {
        console.log(`Headers.get called for: ${name}`);
        if (name.toLowerCase() === 'user-agent') return 'test-agent';
        return null;
      }
    },
    method: 'GET',
    cf: {
      country: 'US',
      clientIp: '192.168.1.1'
    },
    clone: () => mockRequest,
    body: {
      getReader: () => {
        console.log('Body.getReader called');
        return {
          read: async () => {
            console.log('Body read called');
            return { done: true, value: Buffer.from('{"test": "value"}') };
          }
        };
      }
    }
  };
  
  // Test conditions
  const conditions = [
    { field: 'headers.user-agent', operator: 'eq', value: 'test-agent' },
    { field: 'headers.user-agent', operator: 'contains', value: 'test' },
    { field: 'headers.user-agent', operator: 'matches', value: 'test.*' },
    { field: 'headers.user-agent', operator: 'matches', value: 'test.*' }
  ];
  
  console.log('Evaluating conditions...');
  const conditionEvaluator = ConditionEvaluatorService.getInstance();
  const result = await conditionEvaluator.evaluateConditions(mockRequest, conditions, 'and');
  console.log('Result:', result);
  
  console.log('Test complete!');
}

runTest().catch(error => {
  console.error('Test failed:', error);
});