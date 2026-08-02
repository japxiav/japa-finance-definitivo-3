import { normalizeMerchant } from '../core/merchant';
import type { Transaction } from '../core/types';

function cleanName(value: string): string {
  return value
    .replace(/["“”]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:]+$/g, '')
    .trim();
}

export function extractCounterpartyName(transaction: Pick<Transaction, 'descriptionOriginal' | 'originalData' | 'bankType'>): string | undefined {
  const row = transaction.originalData ?? {};
  const direct = row['Payer Name'] || row['Payee Name'] || row['Beneficiário'] || row['Contraparte'] || row['Counterparty'] || row['Recipient'];
  if (direct?.trim()) return cleanName(direct);

  const description = transaction.descriptionOriginal;
  const patterns = [
    /(?:recebeu dinheiro de|received money from|received from|transferência de|transferencia de)\s+(.+?)(?:\s+com a referência|\s+with (?:the )?reference|$)/i,
    /(?:enviou dinheiro para|sent money to|sent to|transferência para|transferencia para)\s+(.+?)(?:\s+com a referência|\s+with (?:the )?reference|$)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(description);
    if (match?.[1]) return cleanName(match[1]);
  }
  return undefined;
}

export function friendlyDescriptionFor(transaction: Pick<Transaction,
  'descriptionOriginal' | 'technicalType' | 'direction' | 'bankProduct' | 'originalData'
>): string {
  const original = transaction.descriptionOriginal.trim();
  const counterparty = extractCounterpartyName({
    descriptionOriginal: original,
    originalData: transaction.originalData,
    bankType: undefined,
  });

  if (transaction.technicalType === 'bank_fee') {
    if (/wise charges for|fee-balance|comiss|commission/i.test(original)) return 'Taxa da Wise';
    return 'Taxa bancária';
  }
  if (transaction.technicalType === 'currency_conversion') return 'Conversão de moeda';
  if (transaction.technicalType === 'internal_transfer') {
    if (/rende\+/i.test(original)) return transaction.direction === 'outflow'
      ? 'Transferência para Wise Rende+'
      : 'Retirada do Wise Rende+';
    if (/subconta|subaccount/i.test(original)) return transaction.direction === 'outflow'
      ? 'Transferência para subconta'
      : 'Retirada de subconta';
    return 'Transferência entre suas contas';
  }
  if (transaction.technicalType === 'incoming_transfer' && counterparty) return `Recebido de ${counterparty}`;
  if (transaction.technicalType === 'outgoing_transfer' && counterparty) return `Enviado para ${counterparty}`;
  if (transaction.technicalType === 'refund') return `Reembolso de ${counterparty ?? original}`;

  const merchant = transaction.originalData?.Merchant || transaction.originalData?.Comerciante;
  if (merchant?.trim()) return cleanName(merchant);
  return cleanName(original) || normalizeMerchant(original) || 'Movimentação bancária';
}

export function withFriendlyDescription<T extends Transaction>(transaction: T): T {
  return {
    ...transaction,
    friendlyDescription: friendlyDescriptionFor(transaction),
  };
}
