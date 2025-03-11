// Rule and Configuration types
export interface RateLimit {
  limit: number;
  period: number;
}

export interface FingerprintParameter {
  name: string;
  headerName?: string;
  headerValue?: string;
  cookieName?: string;
  cookieValue?: string;
  // Add support for body fields to align with config storage
  bodyField?: string;
  bodyFieldName?: string;
}

export interface FingerprintConfig {
  parameters: FingerprintParameter[];
}

export interface Condition {
  field?: string;
  operator?: string;
  value?: any;
  type?: string;
  logic?: string;
  conditions?: Condition[];
}

export interface Action {
  type: string;
  statusCode?: number; // Worker uses statusCode internally
  status?: number; // For compatibility with config storage format
  body?: string;
  bodyType?: string;
  parameters?: Record<string, unknown>; // For compatibility with config storage format
}

export interface ConditionGroup {
  conditions: Condition[];
  logic?: string;
  action: Action;
}

export interface Rule {
  id?: string;
  name: string;
  description?: string;
  enabled?: boolean;
  rateLimit: RateLimit;
  fingerprint?: FingerprintConfig;
  initialMatch: ConditionGroup;
  elseIfActions?: ConditionGroup[];
  elseAction?: Action;
  version?: number;
  order?: number; // Worker uses order internally
  priority?: number; // For compatibility with config storage format
  createdAt?: string;
  updatedAt?: string;
}

export interface Config {
  rules: Rule[];
  version?: number;
  updatedAt?: string;
}

// Request and Response types
export interface RateLimitInfo {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  resetFormatted: string;
  period: number;
  action: Action;
  clientIdentifier: string;
  retryAfter?: number;
}

export interface RateLimitResult {
  isAllowed: boolean;
  remaining: number;
  resetTime: number;
}

// Worker environment
export interface Env {
  RATE_LIMITER: DurableObjectNamespace;
  CONFIG_STORAGE: DurableObjectNamespace;
  RATE_LIMIT_INFO_PATH: string;
  ENVIRONMENT: string;
  // Cloudflare Assets binding
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
}

// Durable Object Storage interface
export interface DurableObjectStorage {
  get(key: string): Promise<any>;
  put(key: string, value: any): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export interface DurableObjectState {
  storage: DurableObjectStorage;
}
