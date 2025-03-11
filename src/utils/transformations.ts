/**
 * Data transformation utility for Rule structures
 */
import { Rule, Action, Condition, ConditionGroup, Config } from '../types';

/**
 * Transforms a rule from the canonical format to the worker-compatible format
 */
export function transformRuleForWorker(rule: any): Rule {
  if (!rule) return null;

  // Transform canonical status to worker's statusCode
  const transformAction = (action: any): Action => {
    if (!action) return null;
    
    return {
      type: action.type,
      // Map status to statusCode
      ...(action.status && { statusCode: action.status }),
      // Extract body and bodyType from parameters if present
      ...(action.body && { body: action.body }),
      ...(action.bodyType && { bodyType: action.bodyType }),
      // Extract parameters if any
      ...(action.parameters && Object.keys(action.parameters).reduce((acc, key) => {
        acc[key] = action.parameters[key];
        return acc;
      }, {})),
    };
  };

  // Transform conditions array into a ConditionGroup
  const transformConditions = (conditions: any[]): ConditionGroup => {
    if (!conditions || !Array.isArray(conditions) || conditions.length === 0) {
      return { conditions: [], action: null };
    }
    
    return {
      conditions: conditions.map((condition: any) => {
        // Handle condition groups recursively
        if (condition.conditions) {
          return transformConditions(condition.conditions);
        }
        
        // Handle standard conditions
        const workerCondition: Condition = {
          field: condition.field,
          operator: condition.operator,
          value: condition.value,
        };
        
        // Add logic for operators
        if (condition.type === 'operator') {
          workerCondition.type = 'operator';
          workerCondition.logic = condition.logic;
        }
        
        return workerCondition;
      }),
      logic: 'AND', // Default to AND logic if not specified
    };
  };

  // Build worker-compatible rule
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description || '',
    // Parse enabled flag if present or set to true by default
    enabled: rule.enabled !== undefined ? rule.enabled : true,
    // Map priority to order for worker
    order: rule.order !== undefined ? rule.order : rule.priority,
    // Pass version if available
    ...(rule.version !== undefined && { version: rule.version }),
    // Copy rate limit settings
    rateLimit: {
      limit: rule.rateLimit?.limit,
      period: rule.rateLimit?.period,
    },
    // Transform fingerprint parameters
    fingerprint: {
      parameters: Array.isArray(rule.fingerprint?.parameters) 
        ? rule.fingerprint.parameters.map((param: any) => ({
            name: param.name,
            headerName: param.headerName,
            headerValue: param.headerValue,
            cookieName: param.cookieName,
            cookieValue: param.cookieValue,
            // Worker doesn't use bodyField/bodyFieldName currently
            // Add these fields if needed
          }))
        : [],
    },
    // Transform initialMatch with conditions and action
    initialMatch: {
      ...transformConditions(rule.initialMatch?.conditions),
      action: transformAction(rule.initialMatch?.action),
    },
    // Transform elseIfActions array
    elseIfActions: Array.isArray(rule.elseIfActions)
      ? rule.elseIfActions.map((elseIf: any) => ({
          ...transformConditions(elseIf.conditions),
          action: transformAction(elseIf.action),
        }))
      : [],
    // Transform elseAction if present
    ...(rule.elseAction && { elseAction: transformAction(rule.elseAction) }),
  };
}

/**
 * Transforms an entire config object by transforming each rule
 */
export function transformConfigForWorker(config: any): Config {
  if (!config) return null;

  return {
    rules: Array.isArray(config.rules)
      ? config.rules
          .map(transformRuleForWorker)
          .filter(rule => rule !== null)
          .sort((a, b) => (a.order || 0) - (b.order || 0))
      : [],
    version: config.version,
    updatedAt: config.updatedAt,
  };
}