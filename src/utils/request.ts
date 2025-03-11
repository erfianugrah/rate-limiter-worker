import { REQUEST } from '../constants/index.ts';

/**
 * Get the client IP address from various sources
 * @param request - The HTTP request
 * @param cfData - Cloudflare data object
 * @returns The client IP address or "unknown"
 */
export function getClientIP(request: Request, cfData: any): string {
  const ipSources = [
    () => request.headers.get('true-client-ip'),
    () => request.headers.get('cf-connecting-ip'),
    () => request.headers.get('x-forwarded-for')?.split(',')[0].trim(),
    () => cfData?.clientIp,
  ];

  for (const source of ipSources) {
    const ip = source();
    if (ip) {
      return ip;
    }
  }

  console.warn('Unable to determine client IP from request or CF data');
  return 'unknown';
}

/**
 * Parse cookies from cookie header
 * @param cookieHeader - The cookie header string
 * @returns Object with cookie name-value pairs
 */
export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};

  return cookieHeader.split(';').reduce((cookies: Record<string, string>, cookie: string) => {
    const [name, value] = cookie.trim().split('=').map(decodeURIComponent);
    if (name) cookies[name] = value || '';
    return cookies;
  }, {});
}

/**
 * Get a nested value from an object using a dot-notation path
 * @param obj - The object to extract value from
 * @param path - The dot-notation path (e.g., "user.profile.name")
 * @returns The extracted value or undefined
 */
export function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, part) => current && current[part], obj);
}

/**
 * Read request body with size limits
 * @param request - The HTTP request
 * @returns Promise resolving to the body content string
 */
export async function getRequestBody(request: Request): Promise<string> {
  try {
    const clonedRequest = request.clone();

    // Handle lack of body
    if (!clonedRequest.body) {
      return '';
    }

    const reader = clonedRequest.body.getReader();
    let body = '';
    let bytesRead = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = new TextDecoder().decode(value);
      bytesRead += value.length;

      if (bytesRead <= REQUEST.BODY_SIZE_LIMIT) {
        body += chunk;
      } else {
        body += chunk.slice(0, REQUEST.BODY_SIZE_LIMIT - (bytesRead - value.length));
        console.warn(`Request body exceeded ${REQUEST.BODY_SIZE_LIMIT} bytes. Truncating.`);
        break;
      }
    }

    return body;
  } catch (error) {
    console.error('Error reading request body:', error);
    return '';
  }
}

/**
 * Check if an IP address is within a CIDR range
 * @param ip - The IP address to check
 * @param cidr - The CIDR range (e.g., "192.168.1.0/24")
 * @returns true if the IP is in the CIDR range
 */
export function isIPInCIDR(ip: string, cidr: string): boolean {
  const [range, bitsStr = '32'] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  const mask = ~(2 ** (32 - bits) - 1);

  const ipInt = ip.split('.').reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0) >>> 0;
  const rangeInt = range.split('.').reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0) >>> 0;

  return (ipInt & mask) === (rangeInt & mask);
}
