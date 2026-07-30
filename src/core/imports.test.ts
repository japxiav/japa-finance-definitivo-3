import { describe, expect, it } from 'vitest';
import { getUndoImpact, restoreImport, undoImport } from './imports';
import { initialState } from '../data/defaults';
import type { Transaction } from './types';

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: crypto.randomUUID(), accountId: 'revolut-eur', importId: 'batch-1', dedupFingerprint: crypto.randomUUID(),
    amountCents: 1000, currency: 'EUR', direction: 'outflow', source: 'revolut_csv', status: 'completed', kind: 'expense', technicalType: 'other_expense',
    kindSource: 'bank', analysisExcluded: false, descriptionOriginal: 'Teste', merchantNormalized: 'teste', reportingDate: '2026-07-01',
    categoryId: 'other', categorySource: 'manual', categoryReviewStatus: 'resolved', needsReview: false, reviewReasons: [], manualEditLog: [], originalData: {},
    createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z', ...overrides,
  };
}

describe('importações reversíveis', () => {
  it('anula sem apagar e restaura preservando edições', () => {
    const edited = transaction({ manualEditLog: [{ field: 'categoryId', oldValue: 'other', newValue: 'games', editedAt: '2026-07-02T00:00:00Z' }], categoryId: 'games' });
    const state = {
      ...initialState,
      transactions: [edited],
      imports: [{
        id: 'batch-1', accountId: 'revolut-eur', fileName: 'x.csv', fileHash: 'hash', parserName: 'revolut_csv' as const,
        parserVersion: '0.3.0', createdAt: '', status: 'active' as const, rowsRead: 1, imported: 1, confirmedDuplicates: 0,
        possibleDuplicates: 0, pendingRows: 0, rejected: 0, currencies: ['EUR'],
      }],
    };
    expect(getUndoImpact(state, 'batch-1').manuallyEditedCount).toBe(1);
    const undone = undoImport(state, 'batch-1');
    expect(undone.transactions[0].status).toBe('voided');
    expect(undone.transactions).toHaveLength(1);
    const restored = restoreImport(undone, 'batch-1');
    expect(restored.transactions[0].status).toBe('completed');
    expect(restored.transactions[0].manualEditLog).toHaveLength(1);
  });
});
