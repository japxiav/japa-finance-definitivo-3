import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const checks = [];
function check(label, condition) {
  checks.push({ label, ok: Boolean(condition) });
  if (!condition) process.exitCode = 1;
}

const requiredModules = [
  'src/application/knowledgeEngine.ts',
  'src/application/explanationEngine.ts',
  'src/application/changeDetection.ts',
  'src/application/behaviorMemory.ts',
  'src/application/financialObjects.ts',
  'src/application/financialEvents.ts',
  'src/application/continuousAudit.ts',
  'src/application/contextualInsights.ts',
  'src/application/securityStatus.ts',
  'src/components/KnowledgeCenterPanel.tsx',
  'src/components/SecurityRecoveryPanel.tsx',
  'src/components/ImportGuideModal.tsx',
  'src/components/OnboardingModal.tsx',
];
for (const file of requiredModules) check(`módulo existe: ${file}`, exists(file));

const types = read('src/core/types.ts');
const defaults = read('src/data/defaults.ts');
const storage = read('src/core/storage.ts');
const app = read('src/App.tsx');
const auditApi = read('api/financial-audit.ts');
const assistantApi = read('api/financial-assistant.ts');
const sw = read('public/sw.js');

check('schema 15 tipado', /schemaVersion:\s*15/.test(types));
check('estado inicial no schema 15', /schemaVersion:\s*15/.test(defaults));
check('migração 14 → 15 existe', /function migrateV14/.test(storage) && /schemaVersion:\s*15/.test(storage));
check('objetos financeiros persistidos', /financialObjects/.test(types) && /financialObjects/.test(storage));
check('memória comportamental persistida', /behaviorMemory/.test(types) && /behaviorMemory/.test(storage));
check('onboarding persistido', /onboarding/.test(types) && /OnboardingModal/.test(app));
check('central de compreensão renderizada', /KnowledgeCenterPanel/.test(app) && /activeTab === 'knowledge'/.test(app));
check('segurança e recuperação renderizadas', /SecurityRecoveryPanel/.test(app) && /activeTab === 'security'/.test(app));
check('IA privada sem busca web', !/tools\s*:\s*\[\s*\{\s*type:\s*['\"]web_search/.test(assistantApi));
check('chamadas de IA não armazenadas', /store:\s*false/.test(auditApi) && /store:\s*false/.test(assistantApi));
check('chave OpenAI apenas no servidor', !/VITE_OPENAI_API_KEY/.test(read('src/App.tsx')) && /process\.env\.OPENAI_API_KEY/.test(auditApi));
check('cache PWA atualizado', /japa-finance-shell-alpha9/.test(sw));

for (const item of checks) console.log(`${item.ok ? '✓' : '✗'} ${item.label}`);
if (process.exitCode) console.error('Falha na estrutura Alpha 9.');
else console.log(`Alpha 9: ${checks.length} verificações estruturais aprovadas.`);
