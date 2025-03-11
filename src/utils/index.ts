// Re-export all utility functions
export * from './crypto.ts';
export * from './request.ts';
export * from './transformations.ts';

/**
 * Performance tracking helper
 * @param name - Name of the operation to track
 * @param fn - Function to execute and measure
 * @returns The result of the function
 */
export async function trackPerformance<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const startTime = Date.now();
  try {
    return await fn();
  } finally {
    const duration = Date.now() - startTime;
    console.log(`${name} took ${duration}ms`);
  }
}

/**
 * Logger with support for different log levels and structured logging
 */
export const logger = {
  debug: (message: string, data?: any) => {
    console.debug(message, data ? JSON.stringify(data) : '');
  },
  log: (message: string, data?: any) => {
    console.log(message, data ? JSON.stringify(data) : '');
  },
  info: (message: string, data?: any) => {
    console.info(message, data ? JSON.stringify(data) : '');
  },
  warn: (message: string, data?: any) => {
    console.warn(message, data ? JSON.stringify(data) : '');
  },
  error: (message: string, error?: any) => {
    console.error(message, error instanceof Error ? error.stack : JSON.stringify(error));
  },
};
