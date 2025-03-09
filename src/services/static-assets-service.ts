import { Env, RateLimitInfo } from '../types/index.ts';
import { logger } from '../utils/index.ts';

/**
 * Service for serving static assets, particularly rate limit pages
 */
export class StaticAssetsService {
  private static instance: StaticAssetsService;
  
  /**
   * Get the singleton instance of StaticAssetsService
   * @returns StaticAssetsService instance
   */
  public static getInstance(): StaticAssetsService {
    if (!StaticAssetsService.instance) {
      StaticAssetsService.instance = new StaticAssetsService();
    }
    return StaticAssetsService.instance;
  }
  
  /**
   * Serve the rate limit exceeded page
   * @param env Environment
   * @param request The original request
   * @param rateLimitInfo Rate limit information
   * @returns Response with rate limit page
   */
  public async serveRateLimitPage(
    env: Env,
    request: Request,
    rateLimitInfo: RateLimitInfo
  ): Promise<Response> {
    // Return JSON if the client doesn't accept HTML
    const acceptHeader = request.headers.get('Accept');
    if (!acceptHeader || !acceptHeader.includes('text/html')) {
      return this.createJSONResponse(429, rateLimitInfo);
    }
    
    try {
      // Fetch the static rate limit page
      const pageRequest = new Request(`${new URL(request.url).origin}/pages/rate-limit.html`);
      const pageResponse = await env.ASSETS.fetch(pageRequest);
      
      if (!pageResponse.ok) {
        logger.error('Failed to fetch rate limit page', { status: pageResponse.status });
        return this.createSimpleHTMLResponse(429, rateLimitInfo);
      }
      
      // Get the HTML content
      let html = await pageResponse.text();
      
      // Replace the placeholder with actual rate limit data
      html = html.replace('__RATE_LIMIT_DATA__', JSON.stringify(rateLimitInfo));
      
      // Return the modified HTML response
      return new Response(html, {
        status: 429,
        headers: {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-store, max-age=0',
          'Retry-After': rateLimitInfo.retryAfter?.toString() || '60'
        }
      });
    } catch (error) {
      logger.error('Error serving rate limit page', error);
      return this.createSimpleHTMLResponse(429, rateLimitInfo);
    }
  }
  
  /**
   * Serve the rate limit info page
   * @param env Environment
   * @param request The original request
   * @param rateLimitInfo Rate limit information
   * @returns Response with rate limit info page
   */
  public async serveRateLimitInfoPage(
    env: Env,
    request: Request,
    rateLimitInfo: RateLimitInfo
  ): Promise<Response> {
    // Return JSON if the client doesn't accept HTML
    const acceptHeader = request.headers.get('Accept');
    if (!acceptHeader || !acceptHeader.includes('text/html')) {
      return this.createJSONResponse(200, rateLimitInfo);
    }
    
    try {
      // Fetch the static rate limit info page
      const pageRequest = new Request(`${new URL(request.url).origin}/pages/rate-limit-info.html`);
      const pageResponse = await env.ASSETS.fetch(pageRequest);
      
      if (!pageResponse.ok) {
        logger.error('Failed to fetch rate limit info page', { status: pageResponse.status });
        return this.createJSONResponse(200, rateLimitInfo);
      }
      
      // Get the HTML content
      let html = await pageResponse.text();
      
      // Replace the placeholder with actual rate limit data
      html = html.replace('__RATE_LIMIT_DATA__', JSON.stringify(rateLimitInfo));
      
      // Return the modified HTML response
      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-store, max-age=0'
        }
      });
    } catch (error) {
      logger.error('Error serving rate limit info page', error);
      return this.createJSONResponse(200, rateLimitInfo);
    }
  }
  
  /**
   * Create a simple JSON response
   * @param status HTTP status code
   * @param rateLimitInfo Rate limit information
   * @returns JSON response
   */
  private createJSONResponse(status: number, rateLimitInfo: RateLimitInfo): Response {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0'
    });
    
    if (status === 429 && rateLimitInfo.retryAfter) {
      headers.set('Retry-After', rateLimitInfo.retryAfter.toString());
    }
    
    return new Response(
      JSON.stringify(status === 429 
        ? { status, message: 'Rate limit exceeded', ...rateLimitInfo }
        : { status, ...rateLimitInfo }
      ),
      { status, headers }
    );
  }
  
  /**
   * Create a simple HTML response as fallback
   * @param status HTTP status code
   * @param rateLimitInfo Rate limit information
   * @returns HTML response
   */
  private createSimpleHTMLResponse(status: number, rateLimitInfo: RateLimitInfo): Response {
    const headers = new Headers({
      'Content-Type': 'text/html',
      'Cache-Control': 'no-store, max-age=0'
    });
    
    if (status === 429 && rateLimitInfo.retryAfter) {
      headers.set('Retry-After', rateLimitInfo.retryAfter.toString());
    }
    
    return new Response(
      `<html><body><h1>Rate Limit Exceeded</h1><p>Please try again in ${
        rateLimitInfo.retryAfter || 60
      } seconds.</p></body></html>`,
      { status, headers }
    );
  }
}