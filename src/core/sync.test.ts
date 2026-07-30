import { describe, expect, it } from 'vitest';
import { initialState } from '../data/defaults';
import { canonicalStringify, decideInitialSync, hashAppState } from './sync';
import type { AppState, SyncMetadata } from './types';
import type { RemoteStateSnapshot } from './remoteState';

function changed(description: string): AppState {
  return {
    ...initialState,
    transactions: [{
      id: description,
      accountId: 'revolut-eur',
      dedupFingerprint: description,
      amountCents: 100,
      currency: 'EUR',
      direction: 'outflow',
      source: 'manual',
      status: 'completed',
      kind: 'expense',
      technicalType: 'other_expense',
      kindSource: 'manual',
      analysisExcluded: false,
      descriptionOriginal: description,
      merchantNormalized: description.toLowerCase(),
      reportingDate: '2026-07-26',
      categoryId: 'other',
      categorySource: 'manual',
      categoryReviewStatus: 'resolved',
      needsReview: false,
      reviewReasons: [],
      manualEditLog: [],
      originalData: {},
      createdAt: '2026-07-26T10:00:00Z',
      updatedAt: '2026-07-26T10:00:00Z',
    }],
  };
}

function snapshot(state: AppState, revision = 4): RemoteStateSnapshot {
  return { state, revision, updatedAt: '2026-07-26T11:00:00Z' };
}

async function metadata(base: AppState, revision = 3): Promise<SyncMetadata> {
  return {
    remoteRevision: revision,
    remoteUpdatedAt: '2026-07-26T10:00:00Z',
    lastSyncedStateHash: await hashAppState(base),
  };
}

describe('serialização canônica', () => {
  it('gera a mesma representação mesmo quando jsonb reordena as chaves', () => {
    expect(canonicalStringify({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(canonicalStringify({ a: { c: 3, d: 4 }, b: 2 }));
  });
});

describe('decisão de sincronização inicial', () => {
  it('usa a nuvem quando o cache local não mudou desde a última sincronização', async () => {
    const base = changed('base');
    const remote = changed('mudança em outro aparelho');
    const result = await decideInitialSync(base, snapshot(remote), await metadata(base), initialState);
    expect(result.kind).toBe('use_remote');
  });

  it('envia o cache local quando só o aparelho mudou offline', async () => {
    const base = changed('base');
    const local = changed('mudança offline');
    const result = await decideInitialSync(local, snapshot(base), await metadata(base), initialState);
    expect(result.kind).toBe('upload_local');
  });

  it('bloqueia e mostra conflito quando local e nuvem mudaram', async () => {
    const base = changed('base');
    const local = changed('mudança offline');
    const remote = changed('mudança em outro aparelho');
    const result = await decideInitialSync(local, snapshot(remote), await metadata(base), initialState);
    expect(result.kind).toBe('conflict');
  });

  it('não adivinha em instalação antiga sem metadados', async () => {
    const result = await decideInitialSync(
      changed('local antigo'),
      snapshot(changed('nuvem diferente')),
      undefined,
      initialState,
    );
    expect(result.kind).toBe('conflict');
  });

  it('cria a nuvem a partir do cache local quando ainda não existe linha remota', async () => {
    const local = changed('somente local');
    const result = await decideInitialSync(local, undefined, undefined, initialState);
    expect(result).toEqual({ kind: 'create_remote', state: local });
  });
});
