// HTTP status codes
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
};

// Rate limiting constants
export const RATE_LIMIT = {
  STORAGE_PREFIX: 'rate_limit:',
  DEFAULT_STATUS_CODE: 200,
  EXCEEDED_STATUS: 429,
  HEADERS: {
    LIMIT: 'X-Rate-Limit-Limit',
    REMAINING: 'X-Rate-Limit-Remaining',
    RESET: 'X-Rate-Limit-Reset',
    RESET_PRECISE: 'X-Rate-Limit-Reset-Precise',
    PERIOD: 'X-Rate-Limit-Period',
    CLIENT_ID: 'X-Client-Identifier',
    SIMULATED: 'X-Rate-Limit-Simulated',
    CONFIG: 'X-Rate-Limit-Config',
    INFO: 'X-Rate-Limit-Info',
    SERVE_PAGE: 'X-Serve-Rate-Limit-Page',
  },
};

// Config manager constants
export const CONFIG = {
  CACHE_TTL: 60 * 1000, // 1 minute TTL
  ENDPOINT: 'https://rate-limiter-configurator/config',
};

// Request parsing constants
export const REQUEST = {
  BODY_SIZE_LIMIT: 524288, // 512 KB in bytes
};

// Action types
export const ACTION_TYPES = {
  LOG: 'log',
  SIMULATE: 'simulate',
  BLOCK: 'block',
  RATE_LIMIT: 'rateLimit',
  CUSTOM_RESPONSE: 'customResponse',
  ALLOW: 'allow',
};