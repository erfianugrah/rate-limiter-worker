import { CONFIG } from '../constants/index.ts';
import { Config, Env, Rule } from '../types/index.ts';
import { logger, trackPerformance, transformConfigForWorker } from '../utils/index.ts';

/**
 * ConfigService handles fetching and caching configuration for rate limiting
 */
export class ConfigService {
  private static instance: ConfigService;
  private cachedConfig: Config | null = null;
  private lastConfigFetch = 0;

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
   * @returns Configuration object with rules
   */
  public async getConfig(env: Env): Promise<Config | null> {
    // Return cached config immediately if available
    if (this.cachedConfig) {
      logger.debug('Using cached config');
      return this.cachedConfig;
    }

    // No cache, must wait for fetch
    logger.debug('No cache, fetching config directly');
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
        const configResponse = await configStorage.fetch(new Request(CONFIG.ENDPOINT));

        if (!configResponse.ok) {
          throw new Error(
            `Failed to fetch config: ${configResponse.status} ${configResponse.statusText}`
          );
        }

        // Parse the raw config
        const rawConfig = (await configResponse.json()) as { rules?: any[] } | null;

        logger.debug('Fetched raw config', rawConfig);

        if (!rawConfig || !Array.isArray(rawConfig.rules) || rawConfig.rules.length === 0) {
          logger.warn('Config is empty or invalid');
          return null;
        }

        // Transform the config from canonical format to worker format
        const workerConfig = transformConfigForWorker(rawConfig);
        logger.debug('Transformed config for worker', workerConfig);

        this.cachedConfig = workerConfig;
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
