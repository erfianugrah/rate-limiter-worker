import { Env } from '../types';
import { 
  ActionHandlerService, 
  ConditionEvaluatorService, 
  ConfigService, 
  RateLimiterService
} from '../services';
import { logger, trackPerformance } from '../utils';
import { RATE_LIMIT } from '../constants';

// Import UI components if needed
// import { serveRateLimitInfoPage, serveRateLimitPage } from '../ui/pages';

/**
 * Main worker handler
 */
export default {
  /**
   * Handle incoming HTTP requests
   * @param request - The HTTP request
   * @param env - Environment variables
   * @param ctx - Execution context
   * @returns Response
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return await trackPerformance('worker.fetch', async () => {
      logger.info('Received request for URL', { url: request.url });
      const url = new URL(request.url);

      // Initialize services
      const configService = ConfigService.getInstance();
      const conditionEvaluator = ConditionEvaluatorService.getInstance();
      const actionHandler = ActionHandlerService.getInstance();
      const rateLimiterService = RateLimiterService.getInstance();

      // Handle rate limit page requests
      if (request.headers.get(RATE_LIMIT.HEADERS.SERVE_PAGE) === 'true') {
        const rateLimitInfo = JSON.parse(
          request.headers.get(RATE_LIMIT.HEADERS.INFO) || '{}'
        );
        
        // For this refactor we'll return a simple HTML response
        // In the future, we can implement proper UI components
        return new Response(
          `<html><body><h1>Rate Limit Exceeded</h1><p>Please try again in ${rateLimitInfo.retryAfter || 60} seconds.</p></body></html>`,
          {
            status: 429,
            headers: { 'Content-Type': 'text/html' }
          }
        );
      }

      try {
        // Get configuration
        const config = await configService.getConfig(env, ctx);

        if (!config || config.rules.length === 0) {
          logger.info('No rate limiting rules configured, passing through request');
          return fetch(request);
        }

        logger.info(`Loaded ${config.rules.length} rate limiting rules`);

        // Find matching rule
        const matchingRule = await conditionEvaluator.findMatchingRule(request, config);

        if (!matchingRule) {
          logger.info('Request does not match any criteria, passing through to origin');
          return fetch(request);
        }

        logger.info('Request matches criteria for rule', { name: matchingRule.name, action: matchingRule.initialMatch.action.type });

        // Handle rate limit info path
        if (url.pathname === env.RATE_LIMIT_INFO_PATH) {
          logger.info('Serving rate limit info page');
          const { rateLimitInfo } = await rateLimiterService.handleRateLimit(
            request,
            env,
            matchingRule
          );
          
          // Return rate limit info as JSON
          return new Response(JSON.stringify(rateLimitInfo), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // Apply rate limiting
        const { rateLimitInfo, rateLimitResponse } = await rateLimiterService.handleRateLimit(
          request,
          env,
          matchingRule
        );

        let response;
        if (rateLimitInfo.allowed) {
          logger.info('Rate limit not exceeded, forwarding request');
          response = await fetch(request);

          if (matchingRule.initialMatch.action.type === 'simulate') {
            response = new Response(response.body, response);
            response.headers.set(RATE_LIMIT.HEADERS.SIMULATED, 'true');
          }
        } else {
          logger.info('Rate limit exceeded, applying action', { action: matchingRule.initialMatch.action.type });
          response = await actionHandler.handleAction(
            env,
            request,
            rateLimitInfo,
            matchingRule
          );
        }

        return actionHandler.applyRateLimitHeaders(response, rateLimitResponse);
      } catch (error) {
        logger.error('Error in rate limiting', error);
        return fetch(request); // Pass through on error
      }
    });
  },

  /**
   * Handle messages from queue
   * @param batch - Batch of messages
   * @param env - Environment variables
   * @param ctx - Execution context
   */
  async queue(batch: any, env: Env, ctx: ExecutionContext): Promise<void> {
    logger.info(`Received ${batch.messages.length} messages from the queue`);
    
    const configService = ConfigService.getInstance();
    
    for (const message of batch.messages) {
      try {
        if (message.body && message.body.type === 'config_update') {
          logger.info('Received config update notification');
          await configService.getConfig(env, ctx);
          await message.ack();
        } else {
          logger.info('Received unexpected message type', { type: message.body?.type });
          await message.ack();
        }
      } catch (error) {
        logger.error('Error processing queue message', error);
      }
    }
  },
};