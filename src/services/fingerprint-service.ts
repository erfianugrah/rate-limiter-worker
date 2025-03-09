import { 
  FingerprintConfig, 
  FingerprintParameter 
} from '../types/index.ts';
import { 
  getClientIP, 
  getNestedValue, 
  getRequestBody, 
  hashValue, 
  parseCookies, 
  logger 
} from '../utils/index.ts';
import { RATE_LIMIT } from '../constants/index.ts';

/**
 * Service for generating unique client fingerprints for rate limiting
 */
export class FingerprintService {
  private static instance: FingerprintService;

  /**
   * Get the singleton instance of FingerprintService
   * @returns FingerprintService instance
   */
  public static getInstance(): FingerprintService {
    if (!FingerprintService.instance) {
      FingerprintService.instance = new FingerprintService();
    }
    return FingerprintService.instance;
  }

  /**
   * Generate a unique identifier for a client based on the fingerprint configuration
   * @param request - The HTTP request
   * @param ruleName - Name of the rule being applied
   * @param fingerprintConfig - Configuration for fingerprinting
   * @param cfData - Cloudflare specific data
   * @returns Unique client identifier string
   */
  public async getClientIdentifier(
    request: Request, 
    ruleName: string,
    fingerprintConfig?: FingerprintConfig, 
    cfData?: any
  ): Promise<string> {
    // If no fingerprint config is provided, use IP address as fallback
    if (!fingerprintConfig?.parameters || fingerprintConfig.parameters.length === 0) {
      logger.debug(`No fingerprint configured for rule: ${ruleName}, using IP fallback`);
      try {
        // Get client IP as fallback identifier
        const clientIP = await this.getClientIPFallback(request, cfData);
        if (clientIP) {
          return `${RATE_LIMIT.STORAGE_PREFIX}${ruleName}:ip:${clientIP}`;
        }
      } catch (error) {
        logger.warn(`Failed to get IP fallback for rule ${ruleName}`, error);
      }
      
      // If IP fallback fails, use default (but this is less precise)
      return `${RATE_LIMIT.STORAGE_PREFIX}${ruleName}:default`;
    }

    try {
      const fingerprint = await this.generateFingerprint(
        request,
        fingerprintConfig,
        cfData
      );
      
      logger.debug(`Generated fingerprint for rule ${ruleName}: ${fingerprint}`);
      return `${RATE_LIMIT.STORAGE_PREFIX}${ruleName}:fingerprint:${fingerprint}`;
    } catch (error) {
      logger.error(`Error generating fingerprint for rule ${ruleName}`, error);
      
      // On error, try IP fallback instead of throwing
      try {
        const clientIP = await this.getClientIPFallback(request, cfData);
        if (clientIP) {
          logger.info(`Using IP fallback for rule ${ruleName} after fingerprint error`);
          return `${RATE_LIMIT.STORAGE_PREFIX}${ruleName}:ip:${clientIP}`;
        }
      } catch (ipError) {
        logger.warn(`IP fallback also failed for rule ${ruleName}`, ipError);
      }
      
      // If both fingerprint and IP fallback fail, use default with warning
      logger.warn(`Using default identifier for rule ${ruleName} after all fallbacks failed`);
      return `${RATE_LIMIT.STORAGE_PREFIX}${ruleName}:default`;
    }
  }
  
  /**
   * Get client IP address as fallback identifier
   * @param request - The HTTP request
   * @param cfData - Cloudflare specific data
   * @returns Client IP address or null
   */
  private async getClientIPFallback(request: Request, cfData?: any): Promise<string | null> {
    // Try to get IP from Cloudflare data
    if (cfData?.clientIP) {
      return cfData.clientIP;
    }
    
    // Try to get IP from headers
    const forwardedFor = request.headers.get('CF-Connecting-IP') || 
                         request.headers.get('X-Forwarded-For') ||
                         request.headers.get('X-Real-IP');
                         
    if (forwardedFor) {
      // Use the first IP in case of comma-separated list
      const clientIP = forwardedFor.split(',')[0].trim();
      if (clientIP) {
        return clientIP;
      }
    }
    
    return null;
  }

  /**
   * Generate a fingerprint hash based on request parameters
   * @param request - The HTTP request
   * @param fingerprintConfig - Configuration for fingerprinting
   * @param cfData - Cloudflare specific data
   * @returns Fingerprint hash
   */
  private async generateFingerprint(
    request: Request,
    fingerprintConfig: FingerprintConfig,
    cfData?: any
  ): Promise<string> {
    logger.debug('Generating fingerprint with config', fingerprintConfig);

    const parameters = fingerprintConfig.parameters || [];
    const components = await Promise.all(
      parameters.map(async (param) => {
        const value = await this.extractParameterValue(request, param, cfData);
        return value !== undefined && value !== null ? value.toString() : "";
      })
    );

    logger.debug('Final fingerprint components', components);
    const fingerprint = await hashValue(components.join("|"));
    logger.debug('Generated fingerprint', fingerprint);
    
    return fingerprint;
  }

  /**
   * Extract a parameter value from a request based on parameter configuration
   * @param request - The HTTP request
   * @param param - Parameter configuration
   * @param cfData - Cloudflare specific data
   * @returns Extracted parameter value
   */
  private async extractParameterValue(
    request: Request, 
    param: FingerprintParameter, 
    cfData?: any
  ): Promise<string | null> {
    // Extract header name-value pairs
    if (param.name === 'headers.nameValue') {
      return param.headerName && param.headerValue &&
        request.headers.get(param.headerName) === param.headerValue
        ? `${param.headerName}:${param.headerValue}`
        : null;
    }

    // Extract header values
    if (param.name.startsWith('headers.')) {
      const headerName = param.name.slice(8);
      return request.headers.get(headerName);
    }

    // Extract cookie value by name
    if (param.name === 'headers.cookieName') {
      const cookies = parseCookies(request.headers.get('cookie'));
      return param.cookieName ? cookies[param.cookieName] : null;
    }

    // Extract cookie name-value pairs
    if (param.name === 'headers.cookieNameValue') {
      const cookies = parseCookies(request.headers.get('cookie'));
      return param.cookieName && param.cookieValue &&
        cookies[param.cookieName] === param.cookieValue
        ? `${param.cookieName}=${param.cookieValue}`
        : null;
    }

    // Extract URL components
    if (param.name.startsWith('url.')) {
      return getNestedValue(new URL(request.url), param.name.slice(4));
    }

    // Extract Cloudflare data
    if (param.name.startsWith('cf.')) {
      return getNestedValue(cfData, param.name.slice(3));
    }

    // Get client IP
    if (param.name === 'clientIP') {
      return getClientIP(request, cfData);
    }

    // Get request method
    if (param.name === 'method') {
      return request.method;
    }

    // Extract body content
    if (param.name === 'body' || param.name.startsWith('body.')) {
      const bodyContent = await getRequestBody(request);
      
      if (param.name === 'body') {
        return bodyContent;
      }
      
      try {
        return getNestedValue(JSON.parse(bodyContent), param.name.slice(5));
      } catch (e) {
        logger.error('Error parsing body JSON', e);
        return null;
      }
    }

    logger.warn(`Unsupported fingerprint parameter: ${param.name}`);
    return null;
  }
}