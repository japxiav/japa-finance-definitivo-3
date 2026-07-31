import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'src');
const files = [];
function walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else if (path.endsWith('.tsx')) files.push(path);
  }
}
walk(root);

const untypedButtons = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const pattern = /<button\b([^>]*)>/gs;
  let match;
  while ((match = pattern.exec(source))) {
    if (!/\btype=/.test(match[1])) {
      const line = source.slice(0, match.index).split('\n').length;
      untypedButtons.push(`${relative(root, file)}:${line}`);
    }
  }
}
if (untypedButtons.length) {
  throw new Error(`Botões sem tipo explícito:\n${untypedButtons.join('\n')}`);
}

const app = readFileSync(join(root, 'App.tsx'), 'utf8');
const main = readFileSync(join(root, 'main.tsx'), 'utf8');
const checks = [
  ['Error Boundary no ponto de entrada', main.includes('<AppErrorBoundary>')],
  ['shell com cinco áreas principais', ['Início', 'Movimentos', 'Planejar', 'Descobertas', 'Mais'].every((label) => app.includes(`<span>${label}</span>`))],
  ['saldo atual e ponte financeira', app.includes('Saldo atual') && app.includes('balance-bridge')],
  ['filtros Wise/Revolut', app.includes('Todas as instituições') && app.includes('Wise e Revolut separadas')],
  ['detalhamento de transferências', app.includes('Detalhar transferência') && app.includes('<TransferDetailModal')],
  ['revisão de transferências internas', app.includes('Possíveis transferências internas') && app.includes('Confirmar vínculo')],
  ['descobertas acionáveis', app.includes("discoveriesView === 'now'") && app.includes("discoveriesView === 'opportunity'")],
  ['planejamento com dinheiro livre e limite diário', app.includes('DINHEIRO LIVRE') && app.includes('LIMITE DIÁRIO')],
];

for (const [description, passed] of checks) {
  if (!passed) throw new Error(`Verificação estrutural falhou: ${description}`);
  console.log(`✓ ${description}`);
}
console.log(`✓ ${files.length} arquivos TSX sem botão de tipo implícito`);
