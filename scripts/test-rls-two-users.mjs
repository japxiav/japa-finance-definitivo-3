import { createClient } from '@supabase/supabase-js';

const required = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'RLS_USER_A_EMAIL',
  'RLS_USER_A_PASSWORD',
  'RLS_USER_B_EMAIL',
  'RLS_USER_B_PASSWORD',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}

const client = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const a = client();
const b = client();
const signIn = async (instance, email, password) => {
  const { data, error } = await instance.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
};
const userA = await signIn(a, process.env.RLS_USER_A_EMAIL, process.env.RLS_USER_A_PASSWORD);
const userB = await signIn(b, process.env.RLS_USER_B_EMAIL, process.env.RLS_USER_B_PASSWORD);

const marker = { schemaVersion: 6, accounts: [], transactions: [], imports: [], importIssues: [], categories: [], rules: [], balanceSnapshots: [], reservePolicies: [], plannedEvents: [], reconciliationBatches: [], plannedTransfers: [], insightFeedback: [], reviewGroups: [], reviewDecisions: [] };
const { error: upsertA } = await a.from('app_states').upsert({
  user_id: userA.id, schema_version: 4, state: marker, revision: 1,
}, { onConflict: 'user_id', ignoreDuplicates: true });
if (upsertA) throw upsertA;

const { data: own, error: ownError } = await a.from('app_states').select('user_id').eq('user_id', userA.id);
if (ownError || own.length !== 1) throw ownError ?? new Error('User A cannot read own row');

const { data: foreign, error: foreignReadError } = await b.from('app_states').select('user_id').eq('user_id', userA.id);
if (foreignReadError) throw foreignReadError;
if (foreign.length !== 0) throw new Error('RLS leak: user B read user A row');

const { data: foreignUpdate, error: foreignUpdateError } = await b.from('app_states')
  .update({ schema_version: 4 }).eq('user_id', userA.id).select('user_id');
if (foreignUpdateError) throw foreignUpdateError;
if (foreignUpdate.length !== 0) throw new Error('RLS leak: user B updated user A row');

const { data: foreignDelete, error: foreignDeleteError } = await b.from('app_states')
  .delete().eq('user_id', userA.id).select('user_id');
if (foreignDeleteError) throw foreignDeleteError;
if (foreignDelete.length !== 0) throw new Error('RLS leak: user B deleted user A row');

const { error: forgedInsertError } = await b.from('app_states').insert({
  user_id: userA.id, schema_version: 4, state: marker, revision: 1,
});
if (!forgedInsertError) throw new Error('RLS leak: user B inserted a row for user A');

const { data: stillOwn, error: stillOwnError } = await a.from('app_states').select('user_id').eq('user_id', userA.id);
if (stillOwnError || stillOwn.length !== 1) throw stillOwnError ?? new Error('User A lost access after isolation tests');

console.log(`✓ RLS isolation passed for ${userA.id} and ${userB.id}`);
await a.auth.signOut();
await b.auth.signOut();
