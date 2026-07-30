import type { CategoryRule, CurrencyCode, Direction, TechnicalMovementType, TransactionKind } from './types';

/**
 * Normalização conservadora: remove acentos e ruído de pontuação, mas preserva
 * números que podem fazer parte do nome (7-Eleven, 3Arena, Formula 1).
 */
export function normalizeMerchant(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-IE')
    .replace(/(?:\s|[#*])\d{3,}\s*$/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export interface RuleMatchContext {
  currency?: CurrencyCode;
  direction?: Direction;
  kind?: TransactionKind;
  technicalType?: TechnicalMovementType;
}

function ruleScopeMatches(rule: CategoryRule, context?: RuleMatchContext): boolean {
  if (rule.currency && rule.currency !== context?.currency) return false;
  if (rule.direction && rule.direction !== context?.direction) return false;
  if (rule.transactionKind && rule.transactionKind !== context?.kind) return false;
  if (rule.technicalType && rule.technicalType !== context?.technicalType) return false;
  return true;
}

export function matchRule(
  merchant: string,
  rules: CategoryRule[],
  context?: RuleMatchContext,
): CategoryRule | undefined {
  const value = normalizeMerchant(merchant);

  return [...rules]
    .sort((a, b) => a.order - b.order)
    .find((rule) => {
      if (rule.active === false || !ruleScopeMatches(rule, context)) return false;
      const pattern = normalizeMerchant(rule.pattern);
      if (!pattern) return false;
      if (rule.kind === 'exact') return value === pattern;
      if (rule.kind === 'starts_with') return value.startsWith(pattern);
      return value.includes(pattern);
    });
}
