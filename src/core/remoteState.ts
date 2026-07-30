import { supabase } from '../lib/supabase';
import type { AppState } from './types';

export interface RemoteStateSnapshot {
  state: AppState;
  revision: number;
  updatedAt: string;
}

interface RemoteStateRow {
  state: AppState;
  revision: number;
  updated_at: string;
}

function toSnapshot(row: RemoteStateRow): RemoteStateSnapshot {
  return {
    state: row.state,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

export class RemoteStateConflictError extends Error {
  readonly expectedRevision: number | null;
  readonly remote?: RemoteStateSnapshot;

  constructor(expectedRevision: number | null, remote?: RemoteStateSnapshot) {
    super('Os dados na nuvem mudaram desde a última sincronização.');
    this.name = 'RemoteStateConflictError';
    this.expectedRevision = expectedRevision;
    this.remote = remote;
  }
}

export async function loadRemoteState(userId: string): Promise<RemoteStateSnapshot | undefined> {
  if (!supabase) return undefined;
  const { data, error } = await supabase
    .from('app_states')
    .select('state, revision, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? toSnapshot(data as RemoteStateRow) : undefined;
}

/**
 * Compare-and-swap: a gravação só acontece se a revisão remota ainda for a
 * mesma que o aparelho leu. Isso impede que um dispositivo sobrescreva outro
 * silenciosamente.
 */
export async function saveRemoteState(
  userId: string,
  state: AppState,
  expectedRevision: number | null,
): Promise<RemoteStateSnapshot> {
  if (!supabase) throw new Error('Supabase não configurado');

  if (expectedRevision === null) {
    const { data, error } = await supabase
      .from('app_states')
      .insert({
        user_id: userId,
        schema_version: state.schemaVersion,
        state,
        revision: 1,
      })
      .select('state, revision, updated_at')
      .single();

    if (!error && data) return toSnapshot(data as RemoteStateRow);

    const remote = await loadRemoteState(userId);
    if (remote) throw new RemoteStateConflictError(expectedRevision, remote);
    throw error ?? new Error('Não foi possível criar o estado remoto.');
  }

  const nextRevision = expectedRevision + 1;
  const { data, error } = await supabase
    .from('app_states')
    .update({
      schema_version: state.schemaVersion,
      state,
      revision: nextRevision,
    })
    .eq('user_id', userId)
    .eq('revision', expectedRevision)
    .select('state, revision, updated_at')
    .maybeSingle();

  if (error) throw error;
  if (data) return toSnapshot(data as RemoteStateRow);

  const remote = await loadRemoteState(userId);
  throw new RemoteStateConflictError(expectedRevision, remote);
}
