import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const checks = [];

function check(id, description, condition) {
  checks.push({ id, description, passed: Boolean(condition) });
}

const remote = read('src/core/remoteState.ts');
const app = read('src/App.tsx');
const sync = read('src/core/sync.ts');
const migration = read('supabase/migrations/002_optimistic_concurrency.sql');

check('SYNC-STRUCT-001', 'migração incremental existe', existsSync(resolve(root, 'supabase/migrations/002_optimistic_concurrency.sql')));
check('SYNC-STRUCT-002', 'estado remoto possui revisão', /revision/.test(remote) && /revision/.test(migration));
check('SYNC-STRUCT-003', 'gravação usa comparação atômica da revisão', remote.includes(".eq('revision', expectedRevision)"));
check('SYNC-STRUCT-004', 'upsert cego foi removido', !remote.includes('.upsert('));
check('SYNC-STRUCT-005', 'conflito remoto possui erro próprio', remote.includes('class RemoteStateConflictError'));
check('SYNC-STRUCT-006', 'hash usa serialização canônica', sync.includes('canonicalStringify') && sync.includes('.sort('));
check('SYNC-STRUCT-007', 'interface possui modal de conflito', app.includes('function SyncConflictModal'));
check('SYNC-STRUCT-008', 'interface oferece backup local', app.includes('Baixar backup local'));
check('SYNC-STRUCT-009', 'banco exige incremento unitário', migration.includes('revision must increase by exactly one'));
check('SYNC-STRUCT-010', 'testes de decisão existem', existsSync(resolve(root, 'src/core/sync.test.ts')));
check('SYNC-STRUCT-011', 'testes de compare-and-swap existem', existsSync(resolve(root, 'src/core/remoteState.test.ts')));

const failed = checks.filter((item) => !item.passed);
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), checks, failed: failed.length }, null, 2));
if (failed.length) process.exit(1);
