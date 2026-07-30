# Evidências da sincronização v0.4

| ID | Requisito | Código | Interface | Teste | Estado |
|---|---|---|---|---|---|
| JF-SYNC-001 | Snapshot remoto possui revisão crescente | `supabase/migrations/001_initial_schema.sql` e `002_optimistic_concurrency.sql` | Indicador de sincronização | `remoteState.test.ts` | Implementado |
| JF-SYNC-002 | Salvar somente sobre a revisão lida | `src/core/remoteState.ts` | Transparente ao usuário | `só atualiza quando a revisão esperada ainda existe` | Implementado |
| JF-SYNC-003 | Detectar concorrência entre aparelhos | `RemoteStateConflictError` | `SyncConflictModal` | `retorna conflito com a versão atual` | Implementado |
| JF-SYNC-004 | Não escolher nuvem silenciosamente no carregamento | `src/core/sync.ts` | Modal quando ambos divergem | cinco testes de decisão inicial | Implementado |
| JF-SYNC-005 | Detectar edição offline local | `lastSyncedStateHash` em metadata local | Modal ou upload seguro | `envia o cache local quando só o aparelho mudou offline` | Implementado |
| JF-SYNC-006 | Preservar versão substituída | `createCheckpoint` antes da escolha | Botão de backup local | roteiro de aceitação em dois dispositivos | Implementado, aceitação real pendente |
| JF-SYNC-007 | Evitar conflito falso por ordem de chaves do JSONB | `canonicalStringify` | Sem impacto visual | teste de serialização canônica | Implementado |
| JF-SYNC-008 | Impedir cliente de pular revisões | trigger SQL exige `old.revision + 1` | Transparente ao usuário | verificação estrutural | Implementado |

## Resultado executado nesta sessão

- 6/6 cenários de hash e decisão passaram em harness local.
- 2/2 cenários atômicos de gravação remota passaram em harness local.
- 23 arquivos TypeScript/TSX passaram por análise sintática.
- Os módulos novos de sincronização, persistência e tipos passaram em TypeScript estrito com dependências externas declaradas por stub temporário.
- 11/11 verificações estruturais passaram.

## Pendente antes do deploy

O registro npm não respondeu neste ambiente. Portanto, ainda é obrigatório executar em uma rede normal:

```bash
npm install
npm test
npm run build
```

Depois, executar o roteiro de dois dispositivos em `docs/ACCEPTANCE_TEST.md` usando um projeto Supabase real.
