import { readFileSync } from 'node:fs';

const { evaluateVerifiedAccess } = await import('../auth_audit_build/accessControl.js');
let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function test(name, run) {
  try {
    await run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const allowedFacts = {
  expectedUserId: 'user-a',
  authenticatedUserIdBefore: 'user-a',
  authenticatedUserIdAfter: 'user-a',
  sessionEmail: 'owner@example.com',
  remoteAllowed: true,
};

await test('allowlist remota verdadeira autoriza sem depender de VITE_ALLOWED_EMAIL', () => {
  const result = evaluateVerifiedAccess(allowedFacts);
  assert(result.allowed, 'usuário remoto autorizado deveria passar');
});

await test('ausência da allowlist local não transforma false remoto em acesso', () => {
  const result = evaluateVerifiedAccess({ ...allowedFacts, remoteAllowed: false });
  assert(!result.allowed && result.reason === 'not_allowlisted', 'false remoto deve negar');
});

await test('valor remoto truthy diferente de true não autoriza', () => {
  const result = evaluateVerifiedAccess({ ...allowedFacts, remoteAllowed: 'true' });
  assert(!result.allowed && result.reason === 'not_allowlisted', 'somente boolean true deve autorizar');
});

await test('falha da RPC mantém o cofre fechado', () => {
  const result = evaluateVerifiedAccess({ ...allowedFacts, remoteCheckFailed: true });
  assert(!result.allowed && result.reason === 'remote_check_failed', 'erro remoto deve negar');
});

await test('usuário trocado antes da verificação remota é negado', () => {
  const result = evaluateVerifiedAccess({ ...allowedFacts, authenticatedUserIdBefore: 'user-b' });
  assert(!result.allowed && result.reason === 'session_changed', 'identidade inicial divergente deve negar');
});

await test('usuário trocado durante a verificação remota é negado', () => {
  const result = evaluateVerifiedAccess({ ...allowedFacts, authenticatedUserIdAfter: 'user-b' });
  assert(!result.allowed && result.reason === 'session_changed', 'identidade final divergente deve negar');
});

await test('e-mail local configurado funciona apenas como barreira adicional', () => {
  const result = evaluateVerifiedAccess({
    ...allowedFacts,
    configuredAllowedEmail: 'OWNER@example.com ',
    sessionEmail: 'other@example.com',
  });
  assert(!result.allowed && result.reason === 'configured_email_mismatch', 'e-mail divergente deve negar');
});

await test('identidade ausente nunca é tratada como autorização', () => {
  const result = evaluateVerifiedAccess({ ...allowedFacts, authenticatedUserIdAfter: undefined });
  assert(!result.allowed && result.reason === 'identity_unavailable', 'identidade ausente deve negar');
});

await test('configuração indisponível é fail closed', () => {
  const result = evaluateVerifiedAccess({ ...allowedFacts, configurationAvailable: false });
  assert(!result.allowed && result.reason === 'configuration_missing', 'configuração ausente deve negar');
});

await test('integração React remonta o cofre quando o usuário muda', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert(app.includes('<FinanceApp key={session.user.id} session={session} />'), 'FinanceApp precisa de key por usuário');
  assert(app.includes('accessGate.userId !== session.user.id'), 'gate precisa estar vinculado ao usuário atual');
  assert(app.includes('const boundUserId = useRef(session.user.id).current'), 'instância precisa fixar o proprietário');
  assert(app.includes('verifyCurrentUserAccess(expectedUserId, session.user.email)'), 'UI precisa confirmar autorização remota');
});

await test('integração Supabase confirma identidade antes e depois da RPC', () => {
  const source = readFileSync(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8');
  const firstGetUser = source.indexOf('const before = await supabase.auth.getUser()');
  const rpc = source.indexOf("supabase.rpc('current_user_is_allowed')");
  const secondGetUser = source.indexOf('const after = await supabase.auth.getUser()');
  assert(firstGetUser >= 0 && rpc > firstGetUser && secondGetUser > rpc, 'identidade deve cercar a RPC');
  assert(!source.includes('if (!allowedEmail) return true'), 'allowlist local não pode abrir o cofre sozinha');
});


await test('cache local e metadados usam namespace obrigatório por usuário', () => {
  const storage = readFileSync(new URL('../src/core/storage.ts', import.meta.url), 'utf8');
  assert(storage.includes('`${CACHE_PREFIX}:${userId}`'), 'cache principal precisa incluir userId');
  assert(storage.includes('`${CHECKPOINT_PREFIX}:${userId}`'), 'checkpoints precisam incluir userId');
  assert(storage.includes('`${SYNC_METADATA_PREFIX}:${userId}`'), 'metadados de sync precisam incluir userId');
});

await test('estado remoto sempre filtra e grava pelo usuário vinculado', () => {
  const remote = readFileSync(new URL('../src/core/remoteState.ts', import.meta.url), 'utf8');
  assert(remote.includes(".eq('user_id', userId)"), 'leituras e atualizações remotas precisam filtrar userId');
  assert(remote.includes('user_id: userId'), 'criação remota precisa gravar userId vinculado');
});

console.log(`\n${passed}/${passed} verificações de autorização e isolamento aprovadas.`);
