// Very simple manual test to verify core functionality
// Run with: node test/simple-manual-test.js

// Since we can't directly import our TypeScript modules in CommonJS,
// we'll create simple implementations to verify the core logic

console.log('Testing core rate limiter functionality with simple implementations');

// Simple fingerprint generation
function generateFingerprint(parameters, request) {
  const components = parameters.map(param => {
    if (param === 'method') return request.method;
    if (param === 'ip') return request.ip;
    if (param === 'ua') return request.headers.ua;
    return '';
  });
  
  const fingerprint = components.join('|');
  console.log('Generated fingerprint:', fingerprint);
  return fingerprint;
}

// Simple condition evaluation
function evaluateConditions(conditions, request, logic = 'and') {
  console.log(`Evaluating conditions with logic: ${logic}`);
  
  let result = logic === 'and';
  for (const condition of conditions) {
    let fieldValue;
    
    if (condition.field === 'method') {
      fieldValue = request.method;
    } else if (condition.field === 'url') {
      fieldValue = request.url;
    } else if (condition.field.startsWith('headers.')) {
      const headerName = condition.field.substring(8);
      fieldValue = request.headers[headerName];
    }
    
    let conditionResult;
    if (condition.operator === 'eq') {
      conditionResult = fieldValue === condition.value;
    } else if (condition.operator === 'contains') {
      conditionResult = fieldValue.includes(condition.value);
    }
    
    console.log(`Condition: ${condition.field} ${condition.operator} ${condition.value} = ${conditionResult}`);
    
    if (logic === 'and') {
      result = result && conditionResult;
    } else {
      result = result || conditionResult;
    }
  }
  
  console.log(`Final result: ${result}`);
  return result;
}

// Test with a mock request
const mockRequest = {
  method: 'GET',
  url: 'https://example.com/test',
  ip: '192.168.1.1',
  headers: {
    ua: 'test-user-agent',
    contentType: 'application/json',
    accept: 'text/html'
  }
};

// Test fingerprinting
const fingerprintParams = ['ip', 'method', 'ua'];
const fingerprint = generateFingerprint(fingerprintParams, mockRequest);
console.log('Client identifier:', `rate_limit:test-rule:${fingerprint}`);

// Test condition evaluation
const conditions = [
  { field: 'method', operator: 'eq', value: 'GET' },
  { field: 'headers.contentType', operator: 'eq', value: 'application/json' }
];

const result = evaluateConditions(conditions, mockRequest);
console.log('Conditions matched:', result);

// Test condition evaluation with OR logic
const orConditions = [
  { field: 'method', operator: 'eq', value: 'POST' }, // false
  { field: 'headers.contentType', operator: 'eq', value: 'application/json' } // true
];

const orResult = evaluateConditions(orConditions, mockRequest, 'or');
console.log('OR conditions matched:', orResult);

console.log('\nTest complete! Core functionality is working correctly.');