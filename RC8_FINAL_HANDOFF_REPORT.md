# RC8 — Correções finais antes da validação no computador

Version: 0.7.0-rc.8
Date: 2026-07-29
Node: v22.16.0
npm: 10.9.2

## Escopo

- revisão visível de eventos migrados sem `accountId`;
- reativação do evento após seleção de conta;
- evidências de compra baseadas nas ocorrências recorrentes expandidas;
- `datetime-local` no modal de reconciliação;
- sem alteração das regras financeiras aprovadas.

## Resultados reproduzidos

- `npm run verify:consolidation`: 16/16 aprovados;
- `npm run verify:operational`: 16/16 aprovados;
- `npm run verify:architecture`: aprovado;
- `npm run verify:sync`: 11/11 aprovados;
- `npm run verify:security`: aprovado (estático);
- `npm run verify:pwa`: aprovado (estático);
- `npm run verify:supabase`: aprovado (estrutural).

## Novas verificações

- evento legado ambíguo permanece preservado, inativo e marcado para revisão;
- UI lista eventos com `needsAccountReview`;
- seleção de conta preenche `accountId`, remove `needsAccountReview` e reativa o evento;
- evidência de compra inclui a ocorrência mensal expandida com a data correta;
- modal de reconciliação usa `datetime-local` e converte para ISO na confirmação.

## Não executado com sucesso neste ambiente

- `npm ci`;
- suíte Vitest completa;
- build Vite;
- E2E;
- Supabase real;
- deploy.

`npm run typecheck` foi tentado e falhou por dependências ausentes (`react`, `vitest`, `@supabase/supabase-js`, `pdfjs-dist` e tipos relacionados), não por um gate completo reproduzível da aplicação.

## Próximos comandos no computador

```bash
rm -rf node_modules package-lock.json
npm install
rm -rf node_modules
npm ci
npm run typecheck
npm test
npm run build
npm run verify:all
```
