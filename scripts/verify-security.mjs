import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const ignored = new Set([
  'node_modules', '.git', 'dist', 'consolidation_build', 'operational_build',
  'professional_audit_build', 'auth_audit_build',
]);
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (ignored.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else files.push(path);
  }
}
walk(root);

const forbidden = [
  /SUPABASE_SERVICE_ROLE_KEY\s*=/i,
  /SUPABASE_DB_PASSWORD\s*=/i,
  /sb_secret_[A-Za-z0-9_-]+/,
  /service_role\s*[:=]\s*['"][A-Za-z0-9._-]+/i,
];
const findings = [];
for (const file of files) {
  if (/\.(png|jpg|jpeg|gif|zip|pdf|tsbuildinfo)$/i.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(text)) findings.push(`${relative(root, file)} matched ${pattern}`);
  }
}
if (findings.length) {
  console.error('Potential frontend/repository secrets found:\n' + findings.join('\n'));
  process.exit(1);
}

const app = readFileSync(join(root, 'src', 'App.tsx'), 'utf8');
const supabase = readFileSync(join(root, 'src', 'lib', 'supabase.ts'), 'utf8');
const storage = readFileSync(join(root, 'src', 'core', 'storage.ts'), 'utf8');
const remoteState = readFileSync(join(root, 'src', 'core', 'remoteState.ts'), 'utf8');

const requiredChecks = [
  [app.includes('<FinanceApp key={session.user.id} session={session} />'), 'FinanceApp não remonta por usuário'],
  [app.includes('accessGate.userId !== session.user.id'), 'gate de autorização não está vinculado à sessão atual'],
  [app.includes('const boundUserId = useRef(session.user.id).current'), 'FinanceApp não fixa o proprietário da instância'],
  [app.includes('verifyCurrentUserAccess(expectedUserId, session.user.email)'), 'UI não exige autorização remota'],
  [supabase.includes("supabase.rpc('current_user_is_allowed')"), 'RPC de allowlist remota ausente'],
  [supabase.indexOf('const before = await supabase.auth.getUser()') < supabase.indexOf("supabase.rpc('current_user_is_allowed')"), 'identidade não é confirmada antes da RPC'],
  [supabase.indexOf('const after = await supabase.auth.getUser()') > supabase.indexOf("supabase.rpc('current_user_is_allowed')"), 'identidade não é confirmada após a RPC'],
  [!supabase.includes('if (!allowedEmail) return true'), 'allowlist local ainda possui caminho fail-open'],
  [storage.includes('`${CACHE_PREFIX}:${userId}`'), 'cache local não está particionado por usuário'],
  [remoteState.includes(".eq('user_id', userId)"), 'estado remoto não está filtrado por usuário'],
];
const failedChecks = requiredChecks.filter(([passed]) => !passed).map(([, message]) => message);
if (failedChecks.length) {
  console.error('Security flow checks failed:\n' + failedChecks.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}

console.log('✓ no service-role, secret-key, or DB-password value found in tracked source');
console.log('✓ autorização remota é fail closed e vinculada ao usuário atual');
console.log('✓ cache local e estado remoto permanecem particionados por userId');
