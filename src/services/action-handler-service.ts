import { Action, Env, RateLimitInfo, Rule } from '../types/index.ts';
import { ACTION_TYPES, HTTP_STATUS, RATE_LIMIT } from '../constants/index.ts';
import { logger } from '../utils/index.ts';
import { StaticAssetsService } from './static-assets-service.ts';

/**
 * Handles various actions to be taken when rate limits are applied
 */
export class ActionHandlerService {
  private static instance: ActionHandlerService;

  /**
   * Get the singleton instance of ActionHandlerService
   * @returns ActionHandlerService instance
   */
  public static getInstance(): ActionHandlerService {
    if (!ActionHandlerService.instance) {
      ActionHandlerService.instance = new ActionHandlerService();
    }
    return ActionHandlerService.instance;
  }

  /**
   * Apply a rate limit action to a request
   * @param env - Environment variables
   * @param request - The HTTP request
   * @param rateLimitInfo - Information about the rate limit being applied
   * @param rule - The matching rule
   * @returns Response according to the action
   */
  public async handleAction(
    env: Env,
    request: Request,
    rateLimitInfo: RateLimitInfo,
    _rule: Rule
  ): Promise<Response> {
    const action = rateLimitInfo.action;
    const actionType = action.type;

    logger.debug(`Handling action of type: ${actionType}`, rateLimitInfo);

    switch (actionType) {
      case ACTION_TYPES.LOG:
        return this.handleLogAction(request);
        
      case ACTION_TYPES.SIMULATE:
        return this.handleSimulateAction(request);
        
      case ACTION_TYPES.BLOCK:
        return this.handleBlockAction();
        
      case ACTION_TYPES.CUSTOM_RESPONSE:
        return this.handleCustomResponseAction(action);
        
      case ACTION_TYPES.RATE_LIMIT:
        return this.handleRateLimitAction(env, request, rateLimitInfo, action);
        
      default:
        logger.warn(`Unknown action type: ${actionType}`);
        return new Response(JSON.stringify({
          error: 'Unknown action type',
          action: actionType
        }), {
          status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
          headers: { 'Content-Type': 'application/json' }
        });
    }
  }

  /**
   * Applies rate limit headers to a response
   * @param response - Original response
   * @param rateLimitResponse - Response with rate limit info
   * @returns Response with rate limit headers added
   */
  public applyRateLimitHeaders(
    response: Response,
    rateLimitResponse: Response
  ): Response {
    const newHeaders = new Headers(response.headers);
    
    [
      RATE_LIMIT.HEADERS.LIMIT,
      RATE_LIMIT.HEADERS.REMAINING,
      RATE_LIMIT.HEADERS.PERIOD,
      RATE_LIMIT.HEADERS.RESET,
    ].forEach((header) => {
      const value = rateLimitResponse.headers.get(header);
      if (value) {
        newHeaders.set(header, value);
      }
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  /**
   * Handle log action - just logs and passes through
   * @param request - The HTTP request
   * @returns Original fetch response
   */
  private async handleLogAction(request: Request): Promise<Response> {
    logger.info('Logging rate limit exceed');
    return fetch(request);
  }

  /**
   * Handle simulate action - add simulation header
   * @param request - The HTTP request
   * @returns Response with simulation header
   */
  private async handleSimulateAction(request: Request): Promise<Response> {
    logger.info('Simulating rate limit exceed');
    const response = await fetch(request);
    const newResponse = new Response(response.body, response);
    newResponse.headers.set(RATE_LIMIT.HEADERS.SIMULATED, 'true');
    return newResponse;
  }

  /**
   * Handle block action - return 403 Forbidden
   * @returns 403 Forbidden response
   */
  private handleBlockAction(): Response {
    logger.info('Blocking request due to rate limit');
    return new Response('Forbidden', { 
      status: HTTP_STATUS.FORBIDDEN 
    });
  }

  /**
   * Handle custom response action
   * @param action - Action configuration
   * @returns Custom response as configured
   */
  private handleCustomResponseAction(action: Action): Response {
    logger.info('Applying custom response');
    
    let contentType = 'text/plain';
    if (action.bodyType === 'json') {
      contentType = 'application/json';
    } else if (action.bodyType === 'html') {
      contentType = 'text/html';
    }
    
    return new Response(action.body, {
      status: action.statusCode || HTTP_STATUS.OK,
      headers: {
        'Content-Type': contentType,
      },
    });
  }

  /**
   * Handle rate limit action - default rate limit response
   * @param env - Environment variables
   * @param request - The HTTP request
   * @param rateLimitInfo - Rate limit information
   * @param action - Action configuration
   * @returns Rate limit response
   */
  private handleRateLimitAction(
    _env: Env,
    request: Request,
    rateLimitInfo: RateLimitInfo,
    action: Action
  ): Response {
    logger.info('Applying rate limit action');
    
    // Use custom response if defined in the action
    if (action && action.statusCode && action.body) {
      let contentType = 'text/plain';
      if (action.bodyType === 'json') {
        contentType = 'application/json';
      } else if (action.bodyType === 'html') {
        contentType = 'text/html';
      }
      
      return new Response(action.body, {
        status: parseInt(action.statusCode.toString()),
        headers: {
          'Content-Type': contentType,
        },
      });
    }
    
    // Default rate limit behavior
    if (request.headers.get('Accept')?.includes('text/html')) {
      // Return HTML rate limit page from static assets
      return StaticAssetsService.getInstance().serveRateLimitPage(_env, request, rateLimitInfo);
    } else {
      // Return JSON rate limit response
      return new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          retryAfter: rateLimitInfo.retryAfter,
        }),
        {
          status: HTTP_STATUS.TOO_MANY_REQUESTS,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': rateLimitInfo.retryAfter?.toString() || '60',
          },
        }
      );
    }
  }
}