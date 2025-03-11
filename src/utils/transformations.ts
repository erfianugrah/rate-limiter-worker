/**
 * Data transformation utility for Rule structures
 */
import { Rule, Action, Condition, ConditionGroup, Config } from '../types';

/**
 * Transforms a rule from the canonical format to the worker-compatible format
 */
export function transformRuleForWorker(rule: any): Rule | null {
  if (!rule) return null;

  // Transform canonical action to worker format with mappings for both formats
  const transformAction = (action: any): Action | null => {
    if (!action) return null;

    return {
      type: action.type,
      // Preserve both status and statusCode for compatibility
      ...(action.status && {
        status: action.status,
        statusCode: action.status, // Map to statusCode for worker internal use
      }),
      ...(action.statusCode && {
        statusCode: action.statusCode,
        status: action.statusCode, // Map to status for storage compatibility
      }),
      // Extract body and bodyType
      ...(action.body && { body: action.body }),
      ...(action.bodyType && { bodyType: action.bodyType }),
      // Preserve the original parameters object
      ...(action.parameters && { parameters: action.parameters }),
      // Extract parameters if any (for backward compatibility)
      ...(action.parameters &&
        Object.keys(action.parameters).reduce((acc: Record<string, any>, key: string) => {
          acc[key] = action.parameters[key];
          return acc;
        }, {})),
    };
  };

  // Transform conditions array into a ConditionGroup
  const transformConditions = (conditions: any[]): Omit<ConditionGroup, 'action'> => {
    if (!conditions || !Array.isArray(conditions) || conditions.length === 0) {
      return { conditions: [], logic: 'AND' };
    }

    return {
      conditions: conditions.map((condition: any) => {
        // Handle condition groups recursively
        if (condition.conditions) {
          return transformConditions(condition.conditions) as unknown as Condition;
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
    // Support both order and priority for cross-compatibility
    order: rule.order !== undefined ? rule.order : rule.priority,
    priority: rule.priority !== undefined ? rule.priority : rule.order,
    // Pass version if available
    ...(rule.version !== undefined && { version: rule.version }),
    // Pass timestamp fields if available
    ...(rule.createdAt && { createdAt: rule.createdAt }),
    ...(rule.updatedAt && { updatedAt: rule.updatedAt }),
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
            // Add bodyField support to align with other components
            bodyField: param.bodyField,
            bodyFieldName: param.bodyFieldName,
          }))
        : [],
    },
    // Transform initialMatch with conditions and action
    initialMatch: {
      ...transformConditions(rule.initialMatch?.conditions),
      action: transformAction(rule.initialMatch?.action) as Action,
    },
    // Transform elseIfActions array
    elseIfActions: Array.isArray(rule.elseIfActions)
      ? rule.elseIfActions.map((elseIf: any) => ({
          ...transformConditions(elseIf.conditions),
          action: transformAction(elseIf.action) as Action,
        }))
      : [],
    // Transform elseAction if present
    ...(rule.elseAction && { elseAction: transformAction(rule.elseAction) }),
  };
}

/**
 * Transforms an entire config object by transforming each rule
 */
export function transformConfigForWorker(config: any): Config | null {
  if (!config) return null;

  return {
    rules: Array.isArray(config.rules)
      ? config.rules
          .map((rule: Record<string, any>) => transformRuleForWorker(rule))
          .filter((rule: Rule | null): rule is Rule => rule !== null)
          .sort((a: Rule, b: Rule) => (a.order || 0) - (b.order || 0))
      : [],
    version: config.version,
    updatedAt: config.updatedAt,
  };
}
