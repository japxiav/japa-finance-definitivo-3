import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const targets = [join(root, 'src', 'App.tsx'), join(root, 'src', 'ui'), join(root, 'src', 'application')];
const files = [];
for (const target of targets) {
  try {
    if (statSync(target).isFile()) files.push(target);
    else {
      const walk = (dir) => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name);
          if (statSync(path).isDirectory()) walk(path);
          else if (/\.(ts|tsx)$/.test(name)) files.push(path);
        }
      };
      walk(target);
    }
  } catch {}
}
const legacyFinancialFiles = [
  join(root, 'src', 'core', 'assistant.ts'),
  join(root, 'src', 'core', 'forecast.ts'),
];
const remainingLegacyFiles = legacyFinancialFiles.filter(existsSync);
if (remainingLegacyFiles.length) {
  console.error('Motores financeiros legados ainda existem e podem divergir do domínio atual:');
  remainingLegacyFiles.forEach((file) => console.error(`- ${relative(root, file)}`));
  process.exit(1);
}

const forbidden = /(?:from\s+['"][^'"]*core\/(?:assistant|forecast)['"]|import\(['"][^'"]*core\/(?:assistant|forecast)['"]\))/;
const violations = files.filter((file) => forbidden.test(readFileSync(file, 'utf8')));
if (violations.length) {
  console.error('Imports financeiros legados encontrados:');
  violations.forEach((file) => console.error(`- ${relative(root, file)}`));
  process.exit(1);
}

const facade = readFileSync(join(root, 'src', 'application', 'FinancialDecisionFacade.ts'), 'utf8');
if (!/import\s*\{[^}]*addCivilDays[^}]*\}\s*from\s*['"]\.\.\/domain\/dates['"]/.test(facade)) {
  console.error('FinancialDecisionFacade deve reutilizar addCivilDays do domínio.');
  process.exit(1);
}
if (/function\s+addDays\s*\(/.test(facade)) {
  console.error('FinancialDecisionFacade não deve reimplementar aritmética de datas.');
  process.exit(1);
}
const app = readFileSync(join(root, 'src', 'App.tsx'), 'utf8');
if (!/FinancialDecisionFacade/.test(app)) {
  console.error('App.tsx não referencia FinancialDecisionFacade.');
  process.exit(1);
}
console.log('✓ motores financeiros legados foram removidos');
console.log('✓ UI não importa caminhos financeiros legados');
if (!/eventsNeedingAccountReview/.test(app) || !/resolvePlannedEventAccount/.test(app) || !/needsAccountReview:\s*false/.test(app)) {
  console.error('App.tsx não oferece revisão visível para eventos migrados sem conta.');
  process.exit(1);
}
if (!/type="datetime-local"/.test(app)) {
  console.error('Reconciliação não usa campo datetime-local.');
  process.exit(1);
}
console.log('✓ App.tsx usa FinancialDecisionFacade');
console.log('✓ fachada reutiliza addCivilDays do domínio');
console.log('✓ UI permite revisar e reativar eventos migrados sem conta');
console.log('✓ reconciliação usa datetime-local');
