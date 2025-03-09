import { DurableObjectState, Env, RateLimitInfo, RateLimitResult, Rule } from '../types/index.ts';
import { RATE_LIMIT } from '../constants/index.ts';
import { logger, trackPerformance } from '../utils/index.ts';
import { FingerprintService } from './fingerprint-service.ts';

// Define the CloudFlare Durable Object storage interface
interface CFDurableObjectStorage {
  get(key: string): Promise<any>;
  put(key: string, value: any): Promise<void>;
  delete(key: string): Promise<boolean>;
  list?: () => Promise<Map<string, any>>;
}

/**
 * Core rate limiter service for checking and applying rate limits
 */
export class RateLimiterService {
  private static instance: RateLimiterService;
  
  constructor() {
    // Initialize any required services
  }

  /**
   * Get the singleton instance of RateLimiterService
   * @returns RateLimiterService instance
   */
  public static getInstance(): RateLimiterService {
    if (!RateLimiterService.instance) {
      RateLimiterService.instance = new RateLimiterService();
    }
    return RateLimiterService.instance;
  }

  /**
   * Handle rate limiting for a request
   * @param request - The HTTP request
   * @param env - Environment variables
   * @param rule - The matched rule
   * @returns Rate limit info and response
   */
  public async handleRateLimit(
    request: Request,
    env: Env,
    rule: Rule
  ): Promise<{ rateLimitInfo: RateLimitInfo; rateLimitResponse: Response }> {
    return await trackPerformance('handleRateLimit', async () => {
      const rateLimiterId = env.RATE_LIMITER.idFromName('global');
      const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);

      const headers = new Headers(request.headers);
      headers.set(RATE_LIMIT.HEADERS.CONFIG, JSON.stringify(rule));
      headers.set('Content-Type', 'application/json');

      let payload;
      try {
        const clonedRequest = request.clone();
        payload = {
          cf: request.cf || {},
          body: await clonedRequest.text(),
        };
      } catch (error) {
        logger.error('Error reading request body', error);
        payload = { cf: request.cf || {}, body: '' };
      }

      const rateLimiterRequest = new Request(request.url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload),
      });

      const rateLimitResponse = await rateLimiter.fetch(rateLimiterRequest);
      return { 
        rateLimitInfo: await rateLimitResponse.json(), 
        rateLimitResponse 
      };
    });
  }

  /**
   * Class for the RateLimiter Durable Object
   */
  public createRateLimiterDurableObject(state: DurableObjectState, env: Env) {
    return new RateLimiterDurableObject(state, env, this);
  }

  /**
   * Check if a client has exceeded their rate limit
   * @param clientIdentifier - Unique client identifier
   * @param rule - Rate limit rule
   * @param storage - Durable object storage
   * @param now - Current timestamp
   * @returns Rate limit result
   */
  public async checkRateLimit(
    clientIdentifier: string,
    rule: Rule,
    storage: CFDurableObjectStorage,
    now: number
  ): Promise<RateLimitResult> {
    return await trackPerformance('checkRateLimit', async () => {
      const windowSize = rule.rateLimit.period * 1000;
      const limit = rule.rateLimit.limit;

      // Get existing timestamps for this client
      const data = await storage.get(clientIdentifier);
      let timestamps: number[] = data ? JSON.parse(data) : [];
      
      // Filter timestamps to only include those within the current window
      const windowStart = now - windowSize;
      timestamps = timestamps.filter((ts) => ts >= windowStart);

      // Check if client has exceeded the rate limit
      const isAllowed = timestamps.length < limit;
      
      // Add current timestamp if allowed
      if (isAllowed) {
        timestamps.push(now);
      }

      // Only keep the most recent timestamps up to limit
      timestamps = timestamps.slice(-limit);

      // Store updated timestamps
      await storage.put(clientIdentifier, JSON.stringify(timestamps));

      // Calculate reset time
      const oldestTimestamp = timestamps[0] || now;
      const resetTime = Math.max(oldestTimestamp + windowSize, now + 1000);

      return {
        isAllowed,
        remaining: Math.max(0, limit - timestamps.length),
        resetTime,
      };
    });
  }

  /**
   * Create a rate limit info response
   * @param isAllowed - Whether the request is allowed
   * @param rule - Rate limit rule
   * @param remaining - Remaining requests
   * @param resetTime - Time when the rate limit resets
   * @param retryAfter - Time to wait before retrying
   * @param clientIdentifier - Unique client identifier
   * @param action - Action to apply
   * @returns Response with rate limit info
   */
  public createRateLimitResponse(
    isAllowed: boolean,
    rule: Rule,
    remaining: number,
    resetTime: number,
    retryAfter: number,
    clientIdentifier: string,
    action: any
  ): Response {
    const headers = new Headers({
      'Content-Type': 'application/json',
      [RATE_LIMIT.HEADERS.LIMIT]: rule.rateLimit.limit.toString(),
      [RATE_LIMIT.HEADERS.REMAINING]: remaining.toString(),
      [RATE_LIMIT.HEADERS.RESET]: Math.floor(resetTime / 1000).toString(),
      [RATE_LIMIT.HEADERS.RESET_PRECISE]: (resetTime / 1000).toFixed(3),
      [RATE_LIMIT.HEADERS.PERIOD]: rule.rateLimit.period.toString(),
      [RATE_LIMIT.HEADERS.CLIENT_ID]: clientIdentifier,
    });

    const responseBody: RateLimitInfo = {
      allowed: isAllowed,
      limit: rule.rateLimit.limit,
      remaining,
      reset: Math.floor(resetTime / 1000),
      resetFormatted: new Date(resetTime).toUTCString(),
      period: rule.rateLimit.period,
      action: action,
      clientIdentifier,
    };

    if (!isAllowed) {
      headers.set('Retry-After', retryAfter.toString());
      responseBody.retryAfter = parseFloat(retryAfter.toFixed(3));
    }

    const status = action.type === 'customResponse'
      ? action.statusCode ||
        (isAllowed ? RATE_LIMIT.DEFAULT_STATUS_CODE : RATE_LIMIT.EXCEEDED_STATUS)
      : isAllowed
      ? RATE_LIMIT.DEFAULT_STATUS_CODE
      : RATE_LIMIT.EXCEEDED_STATUS;

    return new Response(JSON.stringify(responseBody), { status, headers });
  }
}

/**
 * Durable Object implementation for persistent rate limiting
 */
class RateLimiterDurableObject {
  private state: DurableObjectState;
  private rateLimiterService: RateLimiterService;
  private fingerprintService: FingerprintService;

  constructor(state: DurableObjectState, _env: Env, rateLimiterService: RateLimiterService) {
    this.state = state;
    this.rateLimiterService = rateLimiterService;
    this.fingerprintService = FingerprintService.getInstance();
  }

  async fetch(request: Request): Promise<Response> {
    const fetchStartTime = Date.now();
    logger.debug('RateLimiter: Received request');
    
    try {
      const rule = this.parseRule(request);
      if (!rule) {
        return this.errorResponse('Invalid or missing rule');
      }

      // Handle rate limit info requests
      if (request.url.endsWith('/_ratelimit')) {
        return this.getRateLimitInfo(request, rule);
      }

      // Process rate limit request
      try {
        const payload = await request.json() as { cf?: any, body?: string };
        const cf = payload?.cf || {};
        const now = Date.now();

        // Get client identifier based on fingerprint configuration
        const clientIdentifier = await this.fingerprintService.getClientIdentifier(
          request, 
          rule.name,
          rule.fingerprint, 
          cf
        );
        
        logger.debug(`Processing request for client identifier: ${clientIdentifier}`);

        // Check if request matches the rule conditions
        // For this refactor, we'll assume the request has already been matched
        // This would be handled by the condition evaluator before reaching here
        const isInitialMatch = true;

        if (isInitialMatch) {
          logger.debug('Initial match conditions met, applying rate limit');
          
          // Check if client has exceeded rate limit
          const { isAllowed, remaining, resetTime } = await this.rateLimiterService.checkRateLimit(
            clientIdentifier,
            rule,
            this.state.storage as CFDurableObjectStorage,
            now
          );
          
          // Create response with rate limit info
          return this.rateLimiterService.createRateLimitResponse(
            isAllowed,
            rule,
            remaining,
            resetTime,
            Math.max(0, (resetTime - now) / 1000),
            clientIdentifier,
            rule.initialMatch.action
          );
        }

        // Default to allowing if no match
        const action = rule.elseAction || { type: 'allow' };
        return this.rateLimiterService.createRateLimitResponse(
          true,
          rule,
          rule.rateLimit.limit,
          now + rule.rateLimit.period * 1000,
          0,
          clientIdentifier,
          action
        );
      } catch (err) {
        const error = err as Error;
        logger.error('RateLimiter: Unexpected error', error);
        return new Response(
          JSON.stringify({
            error: 'Unexpected error',
            message: error.message || String(err),
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    } finally {
      logger.debug(`RateLimiter: Total fetch processing time: ${Date.now() - fetchStartTime}ms`);
    }
  }

  /**
   * Parse rate limit rule from request headers
   * @param request - HTTP request with rule in headers
   * @returns Parsed rule or null if invalid
   */
  private parseRule(request: Request): Rule | null {
    try {
      const ruleJson = request.headers.get(RATE_LIMIT.HEADERS.CONFIG) || '{}';
      const rule = JSON.parse(ruleJson) as Rule;
      const isValidRule = rule?.name &&
        rule.rateLimit?.limit &&
        rule.rateLimit?.period &&
        rule.initialMatch?.action?.type;

      if (isValidRule) {
        logger.debug('RateLimiter: Parsed rule', rule);
        return rule;
      }
      
      logger.error('RateLimiter: Invalid rule structure', rule);
      return null;
    } catch (error) {
      logger.error('RateLimiter: Error parsing rule', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * Get information about current rate limit status
   * @param request - HTTP request
   * @param rule - Rate limit rule
   * @returns Response with rate limit info
   */
  private async getRateLimitInfo(request: Request, rule: Rule): Promise<Response> {
    try {
      const payload = await request.json() as { cf?: any, body?: string };
      const cf = payload?.cf || {};
      const now = Date.now();
      
      const clientIdentifier = await this.fingerprintService.getClientIdentifier(
        request, 
        rule.name,
        rule.fingerprint, 
        cf
      );

      const { remaining, resetTime } = await this.rateLimiterService.checkRateLimit(
        clientIdentifier,
        rule,
        this.state.storage as CFDurableObjectStorage,
        now
      );

      const responseBody = {
        limit: rule.rateLimit.limit,
        remaining,
        reset: Math.floor(resetTime / 1000),
        resetFormatted: new Date(resetTime).toUTCString(),
        period: rule.rateLimit.period,
      };

      logger.debug('Rate limit info', responseBody);

      return new Response(JSON.stringify(responseBody), {
        status: RATE_LIMIT.DEFAULT_STATUS_CODE,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('RateLimiter: Unexpected error in getRateLimitInfo', error);
      return this.errorResponse('Unexpected error', 500);
    }
  }

  /**
   * Create an error response
   * @param message - Error message
   * @param status - HTTP status code
   * @returns Error response
   */
  private errorResponse(message: string, status = RATE_LIMIT.DEFAULT_STATUS_CODE): Response {
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}