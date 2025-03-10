import { Condition, Config, Rule } from '../types/index.ts';
import { 
  getNestedValue, 
  getRequestBody, 
  isIPInCIDR, 
  logger, 
  trackPerformance 
} from '../utils/index.ts';
import { ConfigService } from './config-service.ts';

/**
 * Evaluates conditions in rules to determine if they match a request
 */
export class ConditionEvaluatorService {
  private static instance: ConditionEvaluatorService;
  private regexCache = new Map<string, RegExp>();
  private configService: ConfigService;

  constructor() {
    this.configService = ConfigService.getInstance();
  }

  /**
   * Get the singleton instance of ConditionEvaluatorService
   * @returns ConditionEvaluatorService instance
   */
  public static getInstance(): ConditionEvaluatorService {
    if (!ConditionEvaluatorService.instance) {
      ConditionEvaluatorService.instance = new ConditionEvaluatorService();
    }
    return ConditionEvaluatorService.instance;
  }

  /**
   * Find a rule that matches the request
   * @param request - The HTTP request
   * @param config - Configuration with rules
   * @returns Matching rule or null if no match
   */
  public async findMatchingRule(request: Request, config: Config): Promise<Rule | null> {
    return await trackPerformance('findMatchingRule', async () => {
      logger.debug('Finding matching rule for request', { url: request.url });
      
      if (!config || !Array.isArray(config.rules)) {
        logger.warn('Invalid config structure');
        return null;
      }

      let lastLogOrSimulateAction = null;
      let lastElseAction = null;

      for (const rule of config.rules) {
        logger.debug('Evaluating rule', { name: rule.name });

        if (!this.configService.isValidRuleStructure(rule)) {
          continue;
        }

        const initialMatches = await this.evaluateConditions(
          request,
          rule.initialMatch.conditions,
          "and" // Default to 'and' logic for initial match
        );
        
        logger.debug(`Initial match for rule ${rule.name}`, { result: initialMatches });

        if (initialMatches) {
          const actionType = rule.initialMatch.action.type;
          if (actionType === "log" || actionType === "simulate") {
            lastLogOrSimulateAction = {
              ...rule,
              actionType,
              action: rule.initialMatch.action,
            };
            logger.debug(`Rule ${rule.name} matched with ${actionType} action, continuing evaluation`);
          } else {
            logger.debug(`Rule ${rule.name} matched with action`, { actionType });
            return { ...rule, actionType, action: rule.initialMatch.action };
          }
        } else if (rule.elseIfActions && rule.elseIfActions.length > 0) {
          for (const elseIfAction of rule.elseIfActions) {
            const elseIfMatches = await this.evaluateConditions(
              request,
              elseIfAction.conditions,
              elseIfAction.logic || "and"
            );
            
            logger.debug(`Else-if match for rule ${rule.name}`, { result: elseIfMatches });
            
            if (elseIfMatches) {
              const actionType = elseIfAction.action.type;
              if (actionType === "log" || actionType === "simulate") {
                lastLogOrSimulateAction = {
                  ...rule,
                  actionType,
                  action: elseIfAction.action,
                };
                logger.debug(`Rule ${rule.name} else-if matched with ${actionType} action, continuing evaluation`);
              } else {
                logger.debug(`Rule ${rule.name} else-if matched with action`, { actionType });
                return { ...rule, actionType, action: elseIfAction.action };
              }
            }
          }
        }

        if (rule.elseAction) {
          lastElseAction = {
            ...rule,
            actionType: rule.elseAction.type,
            action: rule.elseAction,
          };
          logger.debug(`Rule ${rule.name} else action stored as potential fallback`);
        }

        logger.debug(`Finished evaluating rule ${rule.name}`);
      }

      // If we've reached here, no non-log/non-simulate actions were matched
      if (lastElseAction) {
        logger.debug(`Applying else action from rule`, { name: lastElseAction.name });
        return lastElseAction;
      }

      return lastLogOrSimulateAction;
    });
  }

  /**
   * Evaluate a set of conditions against a request
   * @param request - The HTTP request
   * @param conditions - Array of conditions to evaluate
   * @param logic - Logic to apply ('and' or 'or')
   * @returns true if conditions match, false otherwise
   */
  public async evaluateConditions(
    request: Request, 
    conditions: Condition[], 
    logic = "and"
  ): Promise<boolean> {
    return await trackPerformance('evaluateConditions', async () => {
      logger.debug(`Evaluating conditions with logic: ${logic}`);
      logger.debug(`Conditions:`, conditions);

      if (!Array.isArray(conditions)) {
        logger.warn('Invalid conditions structure');
        return false;
      }

      // Initialize field cache if needed
      (request as any)._fieldCache = (request as any)._fieldCache || {};
      (request as any)._bodyCache = (request as any)._bodyCache || null;
      
      let result = logic === "and";
      for (let i = 0; i < conditions.length; i++) {
        const condition = conditions[i];
        if (condition.type === "operator") {
          logger.debug(`Switching logic to: ${condition.logic}`);
          logic = condition.logic || "and";
          continue;
        }

        // Skip early with short-circuit evaluation
        if (logic === "and" && !result) {
          logger.debug(`AND short-circuit, result already false`);
          break;
        }
        if (logic === "or" && result) {
          logger.debug(`OR short-circuit, result already true`);
          break;
        }

        let conditionResult;
        if ("conditions" in condition) {
          logger.debug("Evaluating nested condition group");
          conditionResult = await this.evaluateConditions(
            request,
            condition.conditions || [],
            "and"
          );
        } else {
          conditionResult = await this.evaluateCondition(request, condition);
        }

        if (logic === "and") {
          result = result && conditionResult;
          logger.debug(`AND result so far: ${result}`);
        } else {
          result = result || conditionResult;
          logger.debug(`OR result so far: ${result}`);
        }
      }

      logger.debug(`Final result for this condition group: ${result}`);
      return result;
    });
  }

  /**
   * Evaluate a single condition against a request
   * @param request - The HTTP request
   * @param condition - The condition to evaluate
   * @returns true if condition matches, false otherwise
   */
  private async evaluateCondition(request: Request, condition: Condition): Promise<boolean> {
    const { field, operator, value } = condition;
    
    if (!field || !operator) {
      return false;
    }
    
    logger.debug(`Evaluating condition: ${field} ${operator} ${value}`);

    // Use cached field value if available
    const cacheKey = `field:${field}`;
    let fieldValue;
    
    if ((request as any)._fieldCache[cacheKey] !== undefined) {
      logger.debug(`Using cached value for field: ${field}`);
      fieldValue = (request as any)._fieldCache[cacheKey];
    } else {
      // Extract field value and cache it
      fieldValue = await this.extractFieldValue(request, field);
      
      // Cache the field value
      (request as any)._fieldCache[cacheKey] = fieldValue;
    }

    if (!this.operatorFunctions[operator]) {
      logger.warn(`Invalid operator: ${operator}`);
      return false;
    }

    logger.debug(`Field value: ${fieldValue}`);

    const result = await this.operatorFunctions[operator](fieldValue, value, field);
    logger.debug(`Condition result: ${result}`);

    return result;
  }

  /**
   * Extract a field value from the request
   * @param request - The HTTP request
   * @param field - The field to extract
   * @returns The extracted field value
   */
  private async extractFieldValue(request: Request, field: string): Promise<any> {
    // URL fields
    if (field.startsWith('url.')) {
      const url = new URL(request.url);
      return getNestedValue(url, field.slice(4));
    } 
    
    // Header fields
    if (field.startsWith('headers.')) {
      return request.headers.get(field.slice(8));
    } 
    
    // Cloudflare data fields
    if (field.startsWith('cf.')) {
      return getNestedValue(request.cf, field.slice(3));
    } 
    
    // Body fields
    if (field.startsWith('body.')) {
      // Use cached body if available
      let bodyContent;
      if ((request as any)._bodyCache === null) {
        bodyContent = await getRequestBody(request);
        (request as any)._bodyCache = bodyContent;
      } else {
        bodyContent = (request as any)._bodyCache;
      }
      
      try {
        return getNestedValue(JSON.parse(bodyContent), field.slice(5));
      } catch (e) {
        logger.error('Error parsing body JSON', e);
        return undefined;
      }
    } 
    
    // Special fields
    switch (field) {
      case 'clientIP':
        return request.headers.get('true-client-ip') ||
          request.headers.get('cf-connecting-ip') ||
          request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
          request.cf?.clientIp;
      case 'method':
        return request.method;
      case 'url':
        return request.url;
      case 'body':
        if ((request as any)._bodyCache === null) {
          const bodyContent = await getRequestBody(request);
          (request as any)._bodyCache = bodyContent;
          return bodyContent;
        } else {
          return (request as any)._bodyCache;
        }
      default:
        logger.warn(`Invalid field: ${field}`);
        return undefined;
    }
  }

  /**
   * Get a cached RegExp object
   * @param pattern - The regex pattern
   * @returns A RegExp object
   */
  private getRegex(pattern: string): RegExp | null {
    if (!this.regexCache.has(pattern)) {
      try {
        this.regexCache.set(pattern, new RegExp(pattern));
      } catch (error) {
        logger.error('Invalid regex pattern', { pattern, error });
        return null;
      }
    }
    return this.regexCache.get(pattern) || null;
  }

  /**
   * Operator functions for various condition operators
   */
  private operatorFunctions: Record<string, (a: any, b: any, field?: string) => boolean | Promise<boolean>> = {
    // Short form operators
    'eq': (a: any, b: any, field?: string) => {
      if (field === "clientIP") {
        return b.includes("/") ? isIPInCIDR(a, b) : a === b;
      }
      return a === b;
    },
    'ne': (a: any, b: any) => a !== b,
    'gt': (a: any, b: any) => parseFloat(a) > parseFloat(b),
    'ge': (a: any, b: any) => parseFloat(a) >= parseFloat(b),
    'lt': (a: any, b: any) => parseFloat(a) < parseFloat(b),
    'le': (a: any, b: any) => parseFloat(a) <= parseFloat(b),
    'contains': (a: any, b: any) => String(a).includes(b),
    'not_contains': (a: any, b: any) => !String(a).includes(b),
    'starts_with': (a: any, b: any) => String(a).startsWith(b),
    'ends_with': (a: any, b: any) => String(a).endsWith(b),
    'matches': async (a: any, b: any) => {
      const regex = this.getRegex(b);
      if (!regex) return false;
      return regex.test(String(a));
    },
    'exists': (a: any, _b: any) => a !== undefined && a !== null,
    'not_exists': (a: any, _b: any) => a === undefined || a === null,
    
    // Long form operators (from config storage)
    'equals': function(a: any, b: any, field?: string) {
      return this['eq'](a, b, field);
    },
    'notEquals': function(a: any, b: any) {
      return this['ne'](a, b);
    },
    'greaterThan': function(a: any, b: any) {
      return this['gt'](a, b);
    },
    'greaterThanEqual': function(a: any, b: any) {
      return this['ge'](a, b);
    },
    'lessThan': function(a: any, b: any) {
      return this['lt'](a, b);
    },
    'lessThanEqual': function(a: any, b: any) {
      return this['le'](a, b);
    },
    'notContains': function(a: any, b: any) {
      return this['not_contains'](a, b);
    },
    'startsWith': function(a: any, b: any) {
      return this['starts_with'](a, b);
    },
    'endsWith': function(a: any, b: any) {
      return this['ends_with'](a, b);
    },
    'notExists': function(a: any, b: any) {
      return this['not_exists'](a, b);
    }
  };
}