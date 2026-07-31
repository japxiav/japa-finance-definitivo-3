import type { Transaction, TransactionSource, TechnicalMovementType } from '../core/types';
import { signedNetMovement } from '../core/finance';
import { parseSignedMoneyToCents } from '../core/money';

export interface TransactionFilters {
  currency: string;
  query: string;
  accountId: string;
  categoryId: string;
  periodStart?: string;
  periodEnd?: string;
  minAmount?: string;
  maxAmount?: string;
  direction: 'all' | Transaction['direction'];
  technicalType: 'all' | TechnicalMovementType;
  source: 'all' | TransactionSource;
  reviewOnly: boolean;
}

function optionalMoney(value?: string): number | undefined {
  const clean = value?.trim();
  if (!clean) return undefined;
  try {
    return Math.abs(parseSignedMoneyToCents(clean));
  } catch {
    return undefined;
  }
}

export function filterTransactions(
  transactions: Transaction[],
  filters: TransactionFilters,
): Transaction[] {
  const query = filters.query.trim().toLocaleLowerCase('pt-BR');
  const minimum = optionalMoney(filters.minAmount);
  const maximum = optionalMoney(filters.maxAmount);

  return transactions.filter((transaction) => {
    if (transaction.currency !== filters.currency) return false;
    if (filters.accountId !== 'all' && transaction.accountId !== filters.accountId) return false;
    if (filters.categoryId !== 'all') {
      if (filters.categoryId === 'uncategorized' && transaction.categoryId) return false;
      if (filters.categoryId !== 'uncategorized' && transaction.categoryId !== filters.categoryId) return false;
    }
    if (filters.periodStart && transaction.reportingDate < filters.periodStart) return false;
    if (filters.periodEnd && transaction.reportingDate > filters.periodEnd) return false;
    if (filters.direction !== 'all' && transaction.direction !== filters.direction) return false;
    if (filters.technicalType !== 'all' && transaction.technicalType !== filters.technicalType) return false;
    if (filters.source !== 'all' && transaction.source !== filters.source) return false;
    if (filters.reviewOnly && !transaction.needsReview) return false;

    const magnitude = Math.abs(signedNetMovement(transaction));
    if (minimum !== undefined && magnitude < minimum) return false;
    if (maximum !== undefined && magnitude > maximum) return false;

    if (!query) return true;
    const haystack = [
      transaction.descriptionOriginal,
      transaction.merchantNormalized,
      transaction.note ?? '',
      transaction.bankTransactionId ?? '',
      transaction.bankType ?? '',
      transaction.bankProduct ?? '',
    ].join(' ').toLocaleLowerCase('pt-BR');
    return haystack.includes(query);
  });
}

function escapeCsv(value: string | number | undefined): string {
  const text = value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function transactionsToCsv(
  transactions: Transaction[],
  input: {
    accountName: (accountId: string) => string;
    categoryName: (categoryId?: string) => string;
    technicalTypeName: (technicalType: TechnicalMovementType) => string;
  },
): string {
  const header = [
    'Data',
    'Descrição',
    'Comerciante normalizado',
    'Conta',
    'Moeda',
    'Valor líquido',
    'Direção',
    'Tipo técnico',
    'Categoria',
    'Origem',
    'Status',
    'Precisa revisão',
    'Motivos da revisão',
    'ID bancário',
    'Produto bancário',
    'Nota',
  ];
  const lines = transactions.map((transaction) => [
    transaction.reportingDate,
    transaction.descriptionOriginal,
    transaction.merchantNormalized,
    input.accountName(transaction.accountId),
    transaction.currency,
    (signedNetMovement(transaction) / 100).toFixed(2),
    transaction.direction,
    input.technicalTypeName(transaction.technicalType),
    input.categoryName(transaction.categoryId),
    transaction.source,
    transaction.status,
    transaction.needsReview ? 'sim' : 'não',
    transaction.reviewReasons.join('|'),
    transaction.bankTransactionId,
    transaction.bankProduct,
    transaction.note,
  ].map(escapeCsv).join(','));
  return `\uFEFF${[header.map(escapeCsv).join(','), ...lines].join('\r\n')}`;
}

export function downloadTransactionsCsv(
  transactions: Transaction[],
  fileName: string,
  input: Parameters<typeof transactionsToCsv>[1],
): void {
  const blob = new Blob([transactionsToCsv(transactions, input)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
