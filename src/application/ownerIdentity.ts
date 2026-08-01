import type { OwnerIdentityProfile, SuggestionConfidence, Transaction } from '../core/types';

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9@]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface OwnerIdentityMatch {
  matched: boolean;
  confidence?: SuggestionConfidence;
  evidence: string[];
}

export function matchOwnerIdentity(
  input: Pick<Transaction, 'descriptionOriginal' | 'bankType' | 'kind' | 'technicalType' | 'direction'>,
  profile: OwnerIdentityProfile,
): OwnerIdentityMatch {
  const raw = normalize(`${input.bankType ?? ''} ${input.descriptionOriginal}`);
  if (!raw || (input.kind !== 'transfer' && !['incoming_transfer', 'outgoing_transfer'].includes(input.technicalType))) {
    return { matched: false, evidence: [] };
  }

  const aliases = [...new Set([profile.displayName, ...profile.aliases].map(normalize).filter((value) => value.length >= 3))];
  const directionalPrefix = input.direction === 'outflow'
    ? '(?:sent to|send to|transfer to|transferred to|enviado para|enviada para|enviou dinheiro para|transferencia para|transferido para|pago a)'
    : '(?:received from|receive from|transfer from|transferred from|recebido de|recebida de|recebeu dinheiro de|transferencia de|transferido de)';

  for (const alias of aliases) {
    const pattern = new RegExp(`\\b${directionalPrefix}\\s+${escaped(alias)}\\b`, 'i');
    if (pattern.test(raw)) {
      return {
        matched: true,
        confidence: 'high',
        evidence: [
          `Descrição bancária indica ${input.direction === 'outflow' ? 'envio para' : 'recebimento de'} ${profile.displayName}`,
          'Identidade própria configurada no aplicativo',
        ],
      };
    }
  }

  const normalizedIbans = profile.ibans.map((value) => value.replace(/\s+/g, '').toUpperCase()).filter(Boolean);
  const compactRaw = `${input.bankType ?? ''} ${input.descriptionOriginal}`.replace(/\s+/g, '').toUpperCase();
  const iban = normalizedIbans.find((value) => value.length >= 10 && compactRaw.includes(value));
  if (iban) {
    return {
      matched: true,
      confidence: 'high',
      evidence: ['IBAN de conta própria reconhecido', 'Movimentação bancária classificada como transferência'],
    };
  }

  const aliasMention = aliases.find((alias) => new RegExp(`\\b${escaped(alias)}\\b`, 'i').test(raw));
  if (aliasMention) {
    return {
      matched: false,
      confidence: 'medium',
      evidence: [`O nome ${profile.displayName} aparece, mas sem uma frase bancária direcional inequívoca`],
    };
  }

  return { matched: false, evidence: [] };
}

export function applyOwnerIdentityContext(transaction: Transaction, profile: OwnerIdentityProfile): Transaction {
  if (transaction.status !== 'completed' || transaction.sourceComponent === 'fee' || transaction.kindSource === 'manual' || transaction.manualEditLog.some((edit) => edit.field === 'technicalType')) return transaction;
  const match = matchOwnerIdentity(transaction, profile);
  if (!match.matched || match.confidence !== 'high') {
    return match.evidence.length
      ? { ...transaction, contextConfidence: match.confidence, contextEvidence: match.evidence }
      : transaction;
  }

  return {
    ...transaction,
    kind: 'transfer',
    technicalType: 'internal_transfer',
    kindSource: 'system',
    analysisExcluded: true,
    transferGroupId: transaction.transferGroupId ?? `owner-identity:${transaction.semanticFingerprint ?? transaction.id}`,
    categoryId: undefined,
    categorySource: 'none',
    categoryReviewStatus: 'not_applicable',
    needsReview: false,
    reviewReasons: transaction.reviewReasons.filter((reason) => reason !== 'ambiguous_transfer' && reason !== 'unknown_kind' && reason !== 'uncategorized'),
    ownerIdentityMatched: true,
    contextConfidence: 'high',
    contextEvidence: match.evidence,
  };
}
