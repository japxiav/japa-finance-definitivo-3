# Japa Finance v0.9 Alpha 5.1 — Hotfix de inicialização

## Falha confirmada

A tela de recuperação mostrava `Minified React error #310` e voltava ao mesmo estado após recarregar.

A causa era uma violação da ordem dos Hooks em `FinanceApp`:

- no primeiro render, `state` ainda era `null` e o componente retornava a tela de carregamento;
- depois da hidratação, o render avançava até um `useRef` declarado mais abaixo;
- assim, o segundo render executava um Hook adicional, o que o React bloqueia.

O Hook afetado era `categoryMutationLock`.

## Correção

`categoryMutationLock` foi movido para o bloco inicial de Hooks de `FinanceApp`, antes de qualquer retorno condicional.

Nenhum dado financeiro, schema local ou migration do Supabase foi alterado.

## Compatibilidade

- `schemaVersion`: permanece 9
- Supabase SQL: sem mudanças
- backups Alpha 4/Alpha 5: compatíveis
- estado remoto: sem migração adicional

## Validações

- verificação AST de ordem de Hooks em todos os arquivos TSX;
- transpilation check de todos os arquivos TS/TSX;
- confirmação de que não há Hooks após os retornos de carregamento de `FinanceApp`.

Não foram executados npm, Vitest, Vite, Supabase ou E2E.
