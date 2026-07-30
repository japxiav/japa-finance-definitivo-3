import { sha256Hex } from './hash';
import type { RemoteStateSnapshot } from './remoteState';
import type { AppState, SyncMetadata } from './types';

export type InitialSyncDecision =
  | { kind: 'create_remote'; state: AppState }
  | { kind: 'use_remote'; state: AppState; remote: RemoteStateSnapshot }
  | { kind: 'upload_local'; state: AppState; remote: RemoteStateSnapshot }
  | { kind: 'conflict'; localState: AppState; remote: RemoteStateSnapshot };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export async function hashAppState(state: AppState): Promise<string> {
  return sha256Hex(canonicalStringify(state));
}

/**
 * Decide a hidratação sem apagar alterações locais silenciosamente.
 * A ausência de metadados em uma instalação antiga é tratada como conflito
 * quando local e nuvem divergem, porque adivinhar seria uma forma pomposa de
 * perder dado.
 */
export async function decideInitialSync(
  local: AppState | undefined,
  remote: RemoteStateSnapshot | undefined,
  metadata: SyncMetadata | undefined,
  fallback: AppState,
): Promise<InitialSyncDecision> {
  if (!remote) return { kind: 'create_remote', state: local ?? fallback };
  if (!local) return { kind: 'use_remote', state: remote.state, remote };

  const [localHash, remoteHash] = await Promise.all([
    hashAppState(local),
    hashAppState(remote.state),
  ]);

  if (localHash === remoteHash) return { kind: 'use_remote', state: remote.state, remote };

  if (metadata?.lastSyncedStateHash === localHash) {
    return { kind: 'use_remote', state: remote.state, remote };
  }

  if (metadata?.lastSyncedStateHash === remoteHash) {
    return { kind: 'upload_local', state: local, remote };
  }

  return { kind: 'conflict', localState: local, remote };
}
