# Japa Finance v0.7.0-rc.3 — Portão 2

Data: 2026-07-27

## Entrega

Esta RC integra o fluxo visível do assistente à nova `FinancialDecisionFacade`.

Fluxo ativo:

```text
App.tsx
→ FinancialDecisionFacade
→ appStateAdapter
→ domain/forecast
→ domain/decisions
```

## Alterações principais

- Removido o import de `core/assistant.ts` em `App.tsx`.
- Criada `FinancialDecisionFacade` com:
  - `buildForecast`
  - `evaluatePurchase`
  - `calculateSpendingLimit`
  - `answerQuestion`
- Criado adaptador conservador de `AppState` para `FinancialState`.
- O adaptador bloqueia snapshots ativos com `asOf` diferentes usando `SNAPSHOT_DATE_MISMATCH`.
- O webapp usa o domínio novo para saldo, limite até receita e decisão de compra.
- Evidências estruturadas são preservadas na resposta.
- Fixture `examples/revolut-fee-regression.csv` agora é lida por `readFileSync` e enviada a `previewBankCsv`.
- Corrigido teste antigo para `schemaVersion === 4`.
- Adicionado `verify:architecture`.

## Comandos executados

### `npm run verify:consolidation`

Resultado: aprovado.

- 16/16 invariantes aprovados.
- Inclui o caminho:
  `CSV → previewBankCsv → netMovementCents → reconciliação`.
- Taxa de € 2,20: `reconciliationDifferenceCents === 0`.

### `npm run verify:architecture`

Resultado: aprovado.

- UI/aplicação não importam `core/assistant.ts`.
- UI/aplicação não importam `core/forecast.ts`.
- `App.tsx` usa `FinancialDecisionFacade`.

### Compilação TypeScript isolada da integração

Resultado: aprovado.

Foram compilados em modo estrito:

- `FinancialDecisionFacade.ts`
- `appStateAdapter.ts`
- domínio de forecast e decisões
- tipos e utilitários financeiros requeridos

### `npm run verify:sync`

Resultado: aprovado, 11/11.

### `npm run typecheck`

Resultado: não aprovado no ambiente.

Causa observada: dependências npm ausentes ou indisponíveis, incluindo React, Vitest, Supabase e pdfjs. O erro não veio da compilação isolada da fachada/domínio, que passou.

### `npm test`

Resultado: não executável no ambiente.

Erro observado:

```text
sh: 1: vitest: Permission denied
```

### `npm run build`

Resultado: não aprovado no ambiente pela mesma ausência/inacessibilidade das dependências e tipos externos.

## Estado do legado

`core/assistant.ts` e `core/forecast.ts` ainda existem para preservar a suíte histórica e facilitar comparação, mas não são alcançados pelo `App.tsx`, pela UI ou pela camada de aplicação.

O script arquitetural impede que voltem ao fluxo de produção.

## Limitações restantes

- Não foi possível validar instalação limpa com `npm ci`.
- A suíte Vitest completa e o build Vite ainda precisam ser executados em ambiente com dependências npm válidas.
- O adaptador atual é uma ponte de migração; o schema persistido ainda não armazena `ReconciliationBatch` nativamente.
- Eventos legados sem `accountId` não entram silenciosamente no domínio novo.
- Transferências legadas ainda não são convertidas automaticamente em `PlannedTransfer`.
