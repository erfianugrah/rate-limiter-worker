import { Env } from "../types";
import {
  ActionHandlerService,
  ConditionEvaluatorService,
  ConfigService,
  RateLimiterService,
  StaticAssetsService,
} from "../services";
import { logger, trackPerformance } from "../utils";
import { RATE_LIMIT } from "../constants";

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
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return await trackPerformance("worker.fetch", async () => {
      logger.info("Received request for URL", { url: request.url });
      const url = new URL(request.url);

      // Initialize services
      const configService = ConfigService.getInstance();
      const conditionEvaluator = ConditionEvaluatorService.getInstance();
      const actionHandler = ActionHandlerService.getInstance();
      const rateLimiterService = RateLimiterService.getInstance();
      const staticAssetsService = StaticAssetsService.getInstance();

      // Handle rate limit page requests
      if (request.headers.get(RATE_LIMIT.HEADERS.SERVE_PAGE) === "true") {
        // Safely parse rate limit info with validation
        let rateLimitInfo;
        try {
          const infoHeader = request.headers.get(RATE_LIMIT.HEADERS.INFO) || "{}";
          rateLimitInfo = JSON.parse(infoHeader);
          
          // Validate expected fields
          if (typeof rateLimitInfo !== 'object') {
            throw new Error('Invalid rateLimitInfo format');
          }
        } catch (error) {
          logger.error("Failed to parse rate limit info", error);
          rateLimitInfo = { 
            retryAfter: 60,
            limit: 100,
            period: 60,
            reset: Math.floor(Date.now() / 1000) + 60,
            resetFormatted: new Date(Date.now() + 60000).toUTCString()
          };
        }

        // Use the static assets service to serve the rate limit page
        return staticAssetsService.serveRateLimitPage(env, request, rateLimitInfo);
      }

      try {
        // Get configuration
        const config = await configService.getConfig(env, ctx);

        if (!config || config.rules.length === 0) {
          logger.info(
            "No rate limiting rules configured, passing through request",
          );
          return await globalThis.fetch(request);
        }

        logger.info(`Loaded ${config.rules.length} rate limiting rules`);

        // Find matching rule
        const matchingRule = await conditionEvaluator.findMatchingRule(
          request,
          config,
        );

        if (!matchingRule) {
          logger.info(
            "Request does not match any criteria, passing through to origin",
          );
          return await globalThis.fetch(request);
        }

        logger.info("Request matches criteria for rule", {
          name: matchingRule.name,
          action: matchingRule.initialMatch.action.type,
        });

        // Handle rate limit info path
        if (url.pathname === env.RATE_LIMIT_INFO_PATH) {
          logger.info("Serving rate limit info page");
          const { rateLimitInfo } = await rateLimiterService.handleRateLimit(
            request,
            env,
            matchingRule,
          );

          // Use the static assets service to serve the rate limit info page
          return staticAssetsService.serveRateLimitInfoPage(env, request, rateLimitInfo);
        }

        // Apply rate limiting
        const { rateLimitInfo, rateLimitResponse } = await rateLimiterService
          .handleRateLimit(
            request,
            env,
            matchingRule,
          );

        let response;
        if (rateLimitInfo.allowed) {
          logger.info("Rate limit not exceeded, forwarding request");
          response = await globalThis.fetch(request);

          if (matchingRule.initialMatch.action.type === "simulate") {
            response = new Response(response.body, response);
            response.headers.set(RATE_LIMIT.HEADERS.SIMULATED, "true");
          }
        } else {
          logger.info("Rate limit exceeded, applying action", {
            action: matchingRule.initialMatch.action.type,
          });
          response = await actionHandler.handleAction(
            env,
            request,
            rateLimitInfo,
            matchingRule,
          );
        }

        return actionHandler.applyRateLimitHeaders(response, rateLimitResponse);
      } catch (error) {
        logger.error("Error in rate limiting", error);
        // Return a 500 error response instead of passing through
        const errorHeaders = new Headers();
        errorHeaders.set("Content-Type", "application/json");
        return new Response(
          JSON.stringify({ error: "Rate limiting service error" }),
          { status: 500, headers: errorHeaders }
        );
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
        if (message.body && message.body.type === "config_update") {
          logger.info("Received config update notification");
          await configService.getConfig(env, ctx);
          await message.ack();
        } else {
          logger.info("Received unexpected message type", {
            type: message.body?.type,
          });
          await message.ack();
        }
      } catch (error) {
        logger.error("Error processing queue message", error);
      }
    }
  },
};
