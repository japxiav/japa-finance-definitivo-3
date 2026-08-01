import type {
  Direction,
  TechnicalMovementType,
  TransactionKind,
} from '../core/types';

function searchable(typeRaw: string, description: string): string {
  return `${typeRaw} ${description}`
    .toLocaleLowerCase('pt-BR')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface TechnicalClassification {
  technicalType: TechnicalMovementType;
  kind: TransactionKind;
  analysisExcluded: boolean;
  internalTransfer: boolean;
}

export function isKnownCurrencyConversion(typeRaw: string, description: string): boolean {
  const value = searchable(typeRaw, description);
  return /\b(exchange|exchanged|conversion|converted|convertid[oa]s?|fx|câmbio|cambio|conversão|conversao)\b/.test(value);
}

export function isKnownInternalTransfer(typeRaw: string, description: string): boolean {
  const value = searchable(typeRaw, description);
  return /transfer between balances|transferência entre saldos|transferencia entre saldos/.test(value)
    || /carregamento de subconta|levantamento de subconta|subaccount top up|subaccount withdrawal/.test(value)
    || /^(?:carregamento|card top up|cash top up|top up by bank card)\b/.test(value);
}

export function kindForTechnicalType(type: TechnicalMovementType): TransactionKind {
  if (type === 'salary' || type === 'other_income') return 'income';
  if (type === 'card_payment' || type === 'cash_withdrawal' || type === 'direct_debit' || type === 'bank_fee' || type === 'other_expense') return 'expense';
  if (type === 'refund') return 'refund';
  if (type === 'incoming_transfer' || type === 'outgoing_transfer' || type === 'internal_transfer' || type === 'currency_conversion') return 'transfer';
  if (type === 'adjustment') return 'adjustment';
  return 'unknown';
}

export function isTechnicalTypeDirectionCompatible(type: TechnicalMovementType, direction: Direction): boolean {
  if (type === 'salary' || type === 'other_income' || type === 'incoming_transfer' || type === 'refund') return direction === 'inflow';
  if (type === 'card_payment' || type === 'cash_withdrawal' || type === 'direct_debit' || type === 'bank_fee' || type === 'other_expense' || type === 'outgoing_transfer') return direction === 'outflow';
  return true;
}

export function isCategoryReviewApplicable(type: TechnicalMovementType): boolean {
  return type !== 'internal_transfer' && type !== 'currency_conversion' && type !== 'unknown';
}

export function technicalTypeLabel(type: TechnicalMovementType): string {
  const labels: Record<TechnicalMovementType, string> = {
    salary: 'Salário',
    other_income: 'Outra entrada',
    card_payment: 'Pagamento com cartão',
    cash_withdrawal: 'Saque',
    direct_debit: 'Débito direto',
    bank_fee: 'Taxa bancária',
    other_expense: 'Outra saída',
    refund: 'Reembolso',
    incoming_transfer: 'Transferência recebida',
    outgoing_transfer: 'Transferência enviada',
    internal_transfer: 'Transferência interna',
    currency_conversion: 'Conversão de moeda',
    adjustment: 'Ajuste',
    unknown: 'Tipo técnico pendente',
  };
  return labels[type];
}

export function identifyTechnicalMovement(input: {
  bankType?: string;
  description: string;
  direction: Direction;
}): TechnicalClassification {
  const value = searchable(input.bankType ?? '', input.description);
  let technicalType: TechnicalMovementType;

  if (isKnownCurrencyConversion(input.bankType ?? '', input.description)) {
    technicalType = 'currency_conversion';
  } else if (isKnownInternalTransfer(input.bankType ?? '', input.description)) {
    technicalType = 'internal_transfer';
  } else if (/(?:refund|reverted|reversal|cashback|chargeback|reembolso|estorno|reversão|reversao|devolução do cartão|devolucao do cartao)/.test(value)
    && input.direction === 'inflow') {
    technicalType = 'refund';
  } else if (/(?:card transaction|card payment|transação por cartão|transacao por cartao|pagamento com cartão|pagamento com cartao)/.test(value)
    && input.direction === 'inflow') {
    technicalType = 'refund';
  } else if (/salary|payroll|wages|salário|salario|ordenado/.test(value) && input.direction === 'inflow') {
    technicalType = 'salary';
  } else if (/cash withdrawal|atm|saque|levantamento em dinheiro/.test(value) && input.direction === 'outflow') {
    technicalType = 'cash_withdrawal';
  } else if (/direct debit|débito direto|debito direto/.test(value) && input.direction === 'outflow') {
    technicalType = 'direct_debit';
  } else if (/fee|commission|taxa|comissão|comissao/.test(value) && input.direction === 'outflow') {
    technicalType = 'bank_fee';
  } else if (/card payment|card transaction|cash payment|pagamento com cartão|pagamento com cartao|transação por cartão|transacao por cartao/.test(value) && input.direction === 'outflow') {
    technicalType = 'card_payment';
  } else if (/bank transfer|card to card transfer|international transfer|scheduled transfer|transferência|transferencia|\btransfer\b|enviado para|enviou dinheiro para|recebido de|recebeu dinheiro de|sent to|sent money to|received from|received money from|pix/.test(value)) {
    technicalType = input.direction === 'inflow' ? 'incoming_transfer' : 'outgoing_transfer';
  } else if (/cash deposit|depósito em dinheiro|deposito em dinheiro|interest|juros/.test(value) && input.direction === 'inflow') {
    technicalType = 'other_income';
  } else if (/payment|merchant|purchase|pagamento|compra/.test(value) && input.direction === 'outflow') {
    technicalType = 'other_expense';
  } else {
    technicalType = 'unknown';
  }

  const kind = kindForTechnicalType(technicalType);
  const analysisExcluded = technicalType === 'internal_transfer' || technicalType === 'currency_conversion';
  return {
    technicalType,
    kind,
    analysisExcluded,
    internalTransfer: analysisExcluded,
  };
}

/** Compatibilidade temporária com consumidores antigos. */
export function identifyTechnicalKind(input: {
  bankType?: string;
  description: string;
  direction: Direction;
}): TransactionKind {
  return identifyTechnicalMovement(input).kind;
}

export function defaultTechnicalTypeForKind(kind: TransactionKind, direction: Direction): TechnicalMovementType {
  if (kind === 'income') return 'other_income';
  if (kind === 'expense') return 'other_expense';
  if (kind === 'refund') return 'refund';
  if (kind === 'transfer') return direction === 'inflow' ? 'incoming_transfer' : 'outgoing_transfer';
  if (kind === 'adjustment') return 'adjustment';
  return 'unknown';
}
