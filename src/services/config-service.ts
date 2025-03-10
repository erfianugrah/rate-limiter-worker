import { Config, Env, Rule } from '../types/index.ts';
import { CONFIG } from '../constants/index.ts';
import { logger, trackPerformance } from '../utils/index.ts';

/**
 * ConfigService handles fetching and caching configuration for rate limiting
 */
export class ConfigService {
  private static instance: ConfigService;
  private cachedConfig: Config | null = null;
  private lastConfigFetch = 0;
  private isRefreshing = false;

  /**
   * Get the singleton instance of ConfigService
   * @returns ConfigService instance
   */
  public static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }
  
  /**
   * Invalidate the config cache to force a fresh fetch
   */
  public invalidateCache(): void {
    logger.info('Invalidating config cache');
    this.cachedConfig = null;
    this.lastConfigFetch = 0;
  }

  /**
   * Get configuration from cache or remote source
   * @param env - Environment variables
   * @param ctx - Execution context for background refresh
   * @returns Configuration object with rules
   */
  public async getConfig(env: Env, ctx?: ExecutionContext): Promise<Config | null> {
    const now = Date.now();
    
    // Return fresh cached config immediately
    if (this.cachedConfig && (now - this.lastConfigFetch < CONFIG.CACHE_TTL)) {
      logger.debug('Using fresh cached config');
      return this.cachedConfig;
    }
    
    // Stale-while-revalidate pattern - use stale cache while refreshing in background
    if (this.cachedConfig && !this.isRefreshing && ctx) {
      logger.debug('Using stale cache while refreshing in background');
      ctx.waitUntil(this.refreshConfigAsync(env));
      return this.cachedConfig;
    }
    
    // No valid cache, must wait for fetch
    logger.debug('No valid cache, fetching config directly');
    return await this.fetchAndUpdateConfig(env);
  }

  /**
   * Fetch configuration from remote source and update cache
   * @param env - Environment variables
   * @returns Updated configuration
   */
  private async fetchAndUpdateConfig(env: Env): Promise<Config | null> {
    return await trackPerformance('fetchAndUpdateConfig', async () => {
      try {
        const configStorageId = env.CONFIG_STORAGE.idFromName('global');
        const configStorage = env.CONFIG_STORAGE.get(configStorageId);
        const configResponse = await configStorage.fetch(
          new Request(CONFIG.ENDPOINT)
        );
        
        if (!configResponse.ok) {
          throw new Error(
            `Failed to fetch config: ${configResponse.status} ${configResponse.statusText}`
          );
        }
        
        const config = await configResponse.json() as Config;
        
        logger.debug('Fetched config', config);
        
        if (!config || !Array.isArray(config.rules) || config.rules.length === 0) {
          logger.warn('Config is empty or invalid');
          return null;
        }
        
        this.cachedConfig = config;
        this.lastConfigFetch = Date.now();
        
        logger.info(`New config fetched and cached at ${this.lastConfigFetch}`);
        return this.cachedConfig;
      } catch (error) {
        logger.error('Error fetching config', error);
        return null;
      }
    });
  }

  /**
   * Refresh configuration in background
   * @param env - Environment variables
   */
  private async refreshConfigAsync(env: Env): Promise<void> {
    if (this.isRefreshing) return;
    this.isRefreshing = true;
    
    try {
      logger.debug('Background refresh: Fetching new config...');
      await this.fetchAndUpdateConfig(env);
    } catch (error) {
      logger.error('Error in background refresh', error);
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Validate rule structure
   * @param rule - Rule configuration to validate
   * @returns true if rule structure is valid
   */
  public isValidRuleStructure(rule: Rule): boolean {
    if (!rule.initialMatch) {
      logger.warn(`Rule ${rule.name} is missing initialMatch`);
      return false;
    }
    
    if (rule.elseIfActions && rule.elseIfActions.length > 0 && !rule.elseAction) {
      logger.warn(`Rule ${rule.name} has elseIfActions but no elseAction`);
      return false;
    }
    
    return true;
  }
}