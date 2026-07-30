# Japa Finance RC6 — correções críticas de integração

Version: 0.7.0-rc.6  
Date: 2026-07-28

## Escopo

Correções exclusivamente para as falhas confirmadas na RC5. Nenhuma regra financeira
aprovada foi ampliada.

## Correções

- Eventos planejados criados pela interface exigem `accountId` válido.
- O assistente possui seletor de conta-alvo próprio.
- Forecast diário exige `horizonStart` posterior ao dia de `logicalAsOf`.
  No mesmo dia, o resultado é `INCOMPLETE` com
  `FORECAST_START_NOT_AFTER_RECONCILIATION`, porque não há horário nos eventos civis.
- `signedNetMovement()` é a função canónica para resumos e movimentos por conta.
- Forecast e decisões usam `expandPlannedEventOccurrences()`.
- `AppState` persiste `reconciliationBatches` e `plannedTransfers`.
- O adaptador não fabrica mais batches; estados sem batch canónico são bloqueados.
- Apenas a conta Revolut EUR nasce ativa; contas não utilizadas não bloqueiam o forecast.
- A leitura automática de chaves legadas globais foi removida para evitar migração entre utilizadores.
- A migration `004_personal_access_allowlist.sql` aplica allowlist no banco, além do isolamento por `user_id`.

## Comandos executados

```text
npm run verify:consolidation
npm run verify:operational
npm run verify:all
npm run typecheck
```

## Resultados reproduzidos

```text
verify:consolidation: 16/16
verify:operational: 9 aprovados
verify:architecture: aprovado
verify:sync: 11/11
verify:security: aprovado
verify:pwa: aprovado
verify:supabase: aprovado (somente estrutural)
verify:all: aprovado
```

`npm run typecheck` foi executado, mas não concluiu com sucesso porque as dependências
React, Vitest, Supabase e pdfjs não estão instaladas neste ambiente. Os erros foram de
resolução de módulos/tipos externos; o resultado não é marcado como aprovado.

## Não executado

- `npm install` / geração de `package-lock.json`
- `npm ci`
- suíte Vitest completa
- build Vite
- Supabase real e teste RLS com dois utilizadores
- E2E no navegador
- deploy Vercel
- teste em iPhone

## Contrato temporal adotado

Como `logicalAsOf` é um instante e eventos usam apenas `CivilDate`, um evento no mesmo
dia do snapshot não pode ser ordenado com segurança. Assim:

```text
horizonStart <= date(logicalAsOf)
→ INCOMPLETE / FORECAST_START_NOT_AFTER_RECONCILIATION

horizonStart > date(logicalAsOf)
→ apenas ocorrências dentro do horizonte são projetadas
```

Isso elimina dupla contagem silenciosa e evita que `COMPLETE` prometa precisão inexistente.
