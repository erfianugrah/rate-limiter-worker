// Benchmark test to compare performance optimizations
import { evaluateConditions } from '../src/condition-evaluator.js';

// Create a complex condition set for testing
function createComplexConditions() {
  return [
    { field: 'headers.user-agent', operator: 'eq', value: 'test-agent' },
    { field: 'headers.user-agent', operator: 'contains', value: 'test' },
    { field: 'headers.user-agent', operator: 'matches', value: 'test.*' },
    { field: 'clientIP', operator: 'eq', value: '192.168.1.1' },
    { field: 'method', operator: 'eq', value: 'GET' },
    { field: 'url', operator: 'contains', value: 'example.com' },
    { field: 'headers.user-agent', operator: 'matches', value: 'test.*' }, // Duplicate to test regex caching
    { field: 'clientIP', operator: 'eq', value: '192.168.1.1' }, // Duplicate to test field caching
  ];
}

// Create a mock request
function createMockRequest() {
  return {
    url: 'https://example.com/test?param=value',
    headers: {
      get: (name) => {
        if (name.toLowerCase() === 'user-agent') return 'test-agent';
        return null;
      }
    },
    method: 'GET',
    cf: {
      country: 'US',
      clientIp: '192.168.1.1'
    },
    clone: () => createMockRequest(),
    body: {
      getReader: () => ({
        read: async () => ({ done: true, value: new TextEncoder().encode('{"test": "value"}') })
      })
    }
  };
}

// Run a benchmark
async function runBenchmark(iterations = 100) {
  console.log(`Running benchmark with ${iterations} iterations...`);
  
  const conditions = createComplexConditions();
  const results = {
    totalTime: 0,
    minTime: Number.MAX_VALUE,
    maxTime: 0
  };
  
  for (let i = 0; i < iterations; i++) {
    // Create a fresh request for each iteration
    const request = createMockRequest();
    
    // Disable console logs during benchmark
    const originalConsoleLog = console.log;
    console.log = () => {};
    
    const startTime = performance.now();
    await evaluateConditions(request, conditions, 'and');
    const endTime = performance.now();
    
    // Restore console logs
    console.log = originalConsoleLog;
    
    const elapsedTime = endTime - startTime;
    results.totalTime += elapsedTime;
    results.minTime = Math.min(results.minTime, elapsedTime);
    results.maxTime = Math.max(results.maxTime, elapsedTime);
  }
  
  // Calculate stats
  const avgTime = results.totalTime / iterations;
  
  console.log('Benchmark results:');
  console.log(`  Total time: ${results.totalTime.toFixed(2)} ms`);
  console.log(`  Average time: ${avgTime.toFixed(2)} ms per evaluation`);
  console.log(`  Min time: ${results.minTime.toFixed(2)} ms`);
  console.log(`  Max time: ${results.maxTime.toFixed(2)} ms`);
}

// Run the benchmark
runBenchmark(1000).catch(error => {
  console.error('Benchmark failed:', error);
});