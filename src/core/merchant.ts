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


/**
 * Extrai uma identidade de comerciante/contraparte de descrições bancárias
 * verbosas. Valores e frases do banco mudam a cada linha; o nome econômico
 * costuma permanecer.
 */
export function extractMerchantIdentity(value: string): string {
  const stripped = value
    .replace(/^(?:transa[cç][aã]o|pagamento)\s+por\s+cart[aã]o\s+de\s+-?[\d.,]+\s+[A-Z]{3,6}\s+(?:emitida|emitido)\s+por\s+/i, '')
    .replace(/^card\s+(?:transaction|payment)\s+(?:of\s+)?-?[\d.,]+\s+[A-Z]{3,6}\s+(?:issued\s+by|at)\s+/i, '')
    .replace(/^(?:bank\s+)?transfer(?:red)?\s+(?:to|from)\s+/i, '')
    .replace(/^transfer[eê]ncia\s+(?:para|de)\s+/i, '')
    .replace(/^(?:enviado|enviada)\s+para\s+/i, '')
    .replace(/^(?:recebido|recebida)\s+de\s+/i, '')
    .replace(/-?[\d.,]+\s+(?:EUR|BRL|GBP|USD|CHF|JPY|CAD|AUD)\b/gi, ' ')
    .replace(/\b(?:emitida|emitido|issued)\s+(?:por|by)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalizeMerchant(stripped || value);
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
