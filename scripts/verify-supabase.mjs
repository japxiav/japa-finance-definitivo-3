import { readFileSync } from 'node:fs';
const migrations = [
  'supabase/migrations/001_initial_schema.sql',
  'supabase/migrations/002_optimistic_concurrency.sql',
  'supabase/migrations/003_operational_closure.sql',
];
const sql = migrations.map((file) => readFileSync(file, 'utf8')).join('\n');
for (const required of [
  'enable row level security',
  'force row level security',
  'auth.uid()',
  'for select',
  'for insert',
  'for update',
  'for delete',
  'with check',
]) {
  if (!sql.toLowerCase().includes(required)) throw new Error(`RLS contract missing: ${required}`);
}
const client = readFileSync('src/lib/supabase.ts', 'utf8');
if (!client.includes('VITE_SUPABASE_PUBLISHABLE_KEY')) throw new Error('Publishable key env missing');
if (!client.includes('VITE_ALLOWED_EMAIL')) throw new Error('Allowed email env missing');
console.log('✓ Supabase migrations and frontend environment contract are structurally present');
console.log('NOTE: this is static verification; run the two-user test against a real project.');
