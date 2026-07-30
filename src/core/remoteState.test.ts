import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '../data/defaults';

const mocked = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: { from: mocked.from },
}));

import { RemoteStateConflictError, saveRemoteState } from './remoteState';

function updateBuilder(result: unknown, eqCalls: Array<[string, unknown]>) {
  const builder = {
    update: vi.fn(() => builder),
    eq: vi.fn((field: string, value: unknown) => {
      eqCalls.push([field, value]);
      return builder;
    }),
    select: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
  };
  return builder;
}

function loadBuilder(result: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
  };
  return builder;
}

describe('compare-and-swap remoto', () => {
  beforeEach(() => mocked.from.mockReset());

  it('só atualiza quando a revisão esperada ainda existe', async () => {
    const eqCalls: Array<[string, unknown]> = [];
    mocked.from.mockReturnValue(updateBuilder({
      data: { state: initialState, revision: 8, updated_at: '2026-07-26T12:00:00Z' },
      error: null,
    }, eqCalls));

    const saved = await saveRemoteState('user-1', initialState, 7);

    expect(saved.revision).toBe(8);
    expect(eqCalls).toContainEqual(['user_id', 'user-1']);
    expect(eqCalls).toContainEqual(['revision', 7]);
  });

  it('retorna conflito com a versão atual quando outra revisão venceu', async () => {
    const eqCalls: Array<[string, unknown]> = [];
    mocked.from
      .mockReturnValueOnce(updateBuilder({ data: null, error: null }, eqCalls))
      .mockReturnValueOnce(loadBuilder({
        data: { state: initialState, revision: 9, updated_at: '2026-07-26T12:05:00Z' },
        error: null,
      }));

    try {
      await saveRemoteState('user-1', initialState, 7);
      throw new Error('Era esperado um conflito de revisão');
    } catch (caught) {
      expect(caught).toBeInstanceOf(RemoteStateConflictError);
      const conflict = caught as RemoteStateConflictError;
      expect(conflict.expectedRevision).toBe(7);
      expect(conflict.remote?.revision).toBe(9);
    }
  });
});
