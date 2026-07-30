import { addCents, subtractCents } from './arithmetic';
import { isInstantTimestamp } from './dates';
import type { CurrencyCode, InstantTimestamp } from './model';

export type FeeTreatment =
  | 'INCLUDED_IN_REPORTED_AMOUNT'
  | 'ADDITIONAL_TO_REPORTED_AMOUNT';

export type DuplicateKind =
  | 'EXACT_FILE_DUPLICATE'
  | 'EXACT_SOURCE_ROW_DUPLICATE'
  | 'POSSIBLE_SEMANTIC_DUPLICATE';

export interface NormalizedImportedMovement {
  id: string;
  importBatchId: string;
  accountId: string;
  currency: CurrencyCode;
  sourceRowNumber: number;
  occurredAt: InstantTimestamp;
  reportedAmountCents: number;
  feeCents: number;
  netMovementCents: number;
  feeTreatment: FeeTreatment;
  sourceFingerprint: string;
  semanticFingerprint: string;
}

export interface ImportedRowError {
  sourceRowNumber: number;
  code: string;
  message: string;
}

export interface DuplicateResult {
  kind: DuplicateKind;
  sourceRowNumber: number;
  matchedMovementIds: string[];
}

export interface ImportWarning {
  code: string;
  message: string;
  sourceRowNumber?: number;
}

export interface ImportPreviewResult {
  status: 'READY' | 'INVALID';
  importBatchId: string;
  fileHash: string;
  sourceFormat: string;
  acceptedRows: NormalizedImportedMovement[];
  rejectedRows: ImportedRowError[];
  exactDuplicates: DuplicateResult[];
  possibleDuplicates: DuplicateResult[];
  warnings: ImportWarning[];
  openingBalanceCents?: number;
  closingBalanceCents?: number;
  calculatedNetMovementCents: number;
  reconciliationDifferenceCents?: number;
}

export interface ImportBatch {
  id: string;
  accountId: string;
  fileHash: string;
  sourceFormat: string;
  importedAt: InstantTimestamp;
  confirmedAt?: InstantTimestamp;
  revertedAt?: InstantTimestamp;
  status: 'PREVIEW' | 'CONFIRMED' | 'REVERTED' | 'FAILED';
  movementIds: string[];
  summary: {
    acceptedCount: number;
    rejectedCount: number;
    exactDuplicateCount: number;
    possibleDuplicateCount: number;
  };
}

export function normalizeImportedMovement(input: Omit<
  NormalizedImportedMovement,
  'netMovementCents'
>): NormalizedImportedMovement {
  if (!input.id.trim() || !input.importBatchId.trim() || !input.accountId.trim() || !input.currency.trim()) {
    throw new Error('Movimento importado precisa de identificadores, conta e moeda.');
  }
  if (!Number.isSafeInteger(input.sourceRowNumber) || input.sourceRowNumber <= 0) {
    throw new Error('sourceRowNumber precisa ser inteiro positivo.');
  }
  if (!isInstantTimestamp(input.occurredAt)) {
    throw new Error('occurredAt precisa ser timestamp ISO UTC canônico.');
  }
  if (!input.sourceFingerprint.trim() || !input.semanticFingerprint.trim()) {
    throw new Error('Fingerprints da importação são obrigatórios.');
  }
  if (input.feeTreatment !== 'INCLUDED_IN_REPORTED_AMOUNT' && input.feeTreatment !== 'ADDITIONAL_TO_REPORTED_AMOUNT') {
    throw new Error('feeTreatment inválido.');
  }
  if (!Number.isSafeInteger(input.reportedAmountCents)) {
    throw new Error('reportedAmountCents precisa ser inteiro seguro.');
  }
  if (!Number.isSafeInteger(input.feeCents) || input.feeCents < 0) {
    throw new Error('feeCents precisa ser inteiro seguro não negativo.');
  }

  const netMovementCents =
    input.feeTreatment === 'INCLUDED_IN_REPORTED_AMOUNT'
      ? input.reportedAmountCents
      : subtractCents(input.reportedAmountCents, input.feeCents);
  return { ...input, netMovementCents };
}

export function calculateReconciliation(input: {
  openingBalanceCents: number;
  closingBalanceCents: number;
  movements: NormalizedImportedMovement[];
}): {
  calculatedNetMovementCents: number;
  calculatedClosingBalanceCents: number;
  reconciliationDifferenceCents: number;
} {
  const { openingBalanceCents, closingBalanceCents, movements } = input;
  if (!Number.isSafeInteger(openingBalanceCents) || !Number.isSafeInteger(closingBalanceCents)) {
    throw new Error('Saldos precisam ser inteiros seguros.');
  }
  const calculatedNetMovementCents = movements.reduce(
    (sum, movement) => addCents(sum, movement.netMovementCents),
    0,
  );
  const calculatedClosingBalanceCents = addCents(openingBalanceCents, calculatedNetMovementCents);
  return {
    calculatedNetMovementCents,
    calculatedClosingBalanceCents,
    reconciliationDifferenceCents: subtractCents(closingBalanceCents, calculatedClosingBalanceCents),
  };
}

export function createImportBatch(
  preview: ImportPreviewResult,
  accountId: string,
  importedAt: InstantTimestamp,
): ImportBatch {
  if (!accountId.trim()) throw new Error('accountId é obrigatório.');
  if (!preview.importBatchId.trim() || !preview.fileHash.trim() || !preview.sourceFormat.trim()) {
    throw new Error('Prévia de importação precisa de lote, hash e formato.');
  }
  if (!isInstantTimestamp(importedAt)) throw new Error('importedAt precisa ser timestamp ISO UTC canônico.');
  const movementIds = new Set<string>();
  for (const movement of preview.acceptedRows) {
    if (movement.importBatchId !== preview.importBatchId || movement.accountId !== accountId) {
      throw new Error('Movimento aceito não pertence ao lote e à conta da importação.');
    }
    if (movementIds.has(movement.id)) throw new Error('Prévia contém movimentos duplicados.');
    movementIds.add(movement.id);
  }
  return {
    id: preview.importBatchId,
    accountId,
    fileHash: preview.fileHash,
    sourceFormat: preview.sourceFormat,
    importedAt,
    status: 'PREVIEW',
    movementIds: preview.acceptedRows.map((movement) => movement.id),
    summary: {
      acceptedCount: preview.acceptedRows.length,
      rejectedCount: preview.rejectedRows.length,
      exactDuplicateCount: preview.exactDuplicates.length,
      possibleDuplicateCount: preview.possibleDuplicates.length,
    },
  };
}

export function confirmImportBatch(batch: ImportBatch, confirmedAt: InstantTimestamp): ImportBatch {
  if (!isInstantTimestamp(confirmedAt)) throw new Error('confirmedAt precisa ser timestamp ISO UTC canônico.');
  if (batch.status !== 'PREVIEW') {
    throw new Error('Somente lote em PREVIEW pode ser confirmado.');
  }
  if (confirmedAt < batch.importedAt) throw new Error('confirmedAt não pode anteceder importedAt.');
  return { ...batch, status: 'CONFIRMED', confirmedAt };
}

export function revertImportBatch(batch: ImportBatch, revertedAt: InstantTimestamp): ImportBatch {
  if (!isInstantTimestamp(revertedAt)) throw new Error('revertedAt precisa ser timestamp ISO UTC canônico.');
  if (batch.status !== 'CONFIRMED' || !batch.confirmedAt) {
    throw new Error('Somente lote CONFIRMED pode ser revertido.');
  }
  if (revertedAt < batch.confirmedAt) throw new Error('revertedAt não pode anteceder confirmedAt.');
  return { ...batch, status: 'REVERTED', revertedAt };
}
