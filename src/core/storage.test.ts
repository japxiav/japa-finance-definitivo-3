import { describe, expect, it } from 'vitest';
import { normalizeState, resolveIssues } from './storage';
import { initialState } from '../data/defaults';
import type { ImportIssue } from './types';

describe('backup e pendências', () => {
  it('aceita estado atual válido', () => {
    const restored = normalizeState(JSON.parse(JSON.stringify(initialState)), initialState);
    expect(restored.schemaVersion).toBe(7);
    expect(restored.accounts).toHaveLength(4);
  });

  it('rejeita transação apontando para conta inexistente', () => {
    const invalid = {
      ...initialState,
      transactions: [{
        id: 'x', accountId: 'fantasma', dedupFingerprint: 'x', amountCents: 100, currency: 'EUR', direction: 'outflow',
        source: 'manual', status: 'completed', kind: 'expense', technicalType: 'other_expense', kindSource: 'manual', analysisExcluded: false,
        descriptionOriginal: 'x', merchantNormalized: 'x', reportingDate: '2026-07-01', categoryId: 'other',
        categorySource: 'manual', categoryReviewStatus: 'resolved', needsReview: false, reviewReasons: [], manualEditLog: [], originalData: {}, createdAt: '', updatedAt: '',
      }],
    };
    expect(() => normalizeState(invalid, initialState)).toThrow(/conta inexistente/);
  });

  it('rejeita movimento líquido com sinal contrário à direção', () => {
    const invalid = {
      ...initialState,
      transactions: [{
        id: 'tx-sign', accountId: 'revolut-eur', dedupFingerprint: 'tx-sign', amountCents: 100,
        netMovementCents: 100, currency: 'EUR', direction: 'outflow', source: 'manual',
        status: 'completed', kind: 'expense', technicalType: 'other_expense', kindSource: 'manual', analysisExcluded: false,
        descriptionOriginal: 'Despesa', merchantNormalized: 'despesa', reportingDate: '2026-07-01',
        categoryId: 'other', categorySource: 'manual', categoryReviewStatus: 'resolved', needsReview: false, reviewReasons: [],
        manualEditLog: [], originalData: {}, createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
      }],
    };
    expect(() => normalizeState(invalid, initialState)).toThrow(/movimento líquido incompatível/);
  });

  it('rejeita snapshot cujo instante não coincide com o lote', () => {
    const invalid = {
      ...initialState,
      reconciliationBatches: [{
        id: 'batch-1', logicalAsOf: '2026-07-01T10:00:00.000Z',
        createdAt: '2026-07-01T10:01:00.000Z', source: 'manual', status: 'COMPLETE',
      }],
      balanceSnapshots: [{
        id: 'snapshot-1', accountId: 'revolut-eur', currency: 'EUR', balanceCents: 10000,
        asOf: '2026-07-01T09:00:00.000Z', logicalAsOf: '2026-07-01T09:00:00.000Z',
        source: 'manual', reconciled: true, createdAt: '2026-07-01T10:01:00.000Z',
        reconciliationBatchId: 'batch-1',
      }],
    };
    expect(() => normalizeState(invalid, initialState)).toThrow(/instante diferente do lote/);
  });

  it('resolve pendência sem apagá-la', () => {
    const issue: ImportIssue = {
      id: 'i1', importId: 'b1', accountId: 'revolut-eur', kind: 'row_error', status: 'unresolved',
      message: 'erro', originalData: {}, createdAt: '2026-07-01T00:00:00Z',
    };
    const resolved = resolveIssues([issue], ['i1'], 'ignored');
    expect(resolved).toHaveLength(1);
    expect(resolved[0].status).toBe('ignored');
  });
});
