# Japa Finance v0.7 Consolidation RC — fechamento do marco A/C inicial

## Estado da entrega

Esta entrega inicia a release única de consolidação estrutural combinada. Ela fecha o núcleo de domínio e o primeiro corte do motor de forecast/decisão, sem publicar versões intermediárias.

Versão do pacote: `0.7.0-rc.1`.

## Implementado

### Contrato de domínio isolado do React

Novos módulos:

- `src/domain/model.ts`
- `src/domain/dates.ts`
- `src/domain/validation.ts`
- `src/domain/forecast.ts`
- `src/domain/decisions.ts`
- `src/application/financialPipeline.ts`
- `src/infrastructure/importIntegrity.ts`
- `src/infrastructure/tabSync.ts`

### Reconciliação

`ReconciliationBatch` é a unidade de seleção dos saldos.

O forecast:

- recebe um `reconciliationBatchId`;
- nunca procura snapshots “mais recentes” de lotes diferentes;
- exige um snapshot por conta ativa no lote;
- retorna `INCOMPLETE` sem projeções quando faltam snapshots;
- retorna `INVALID` sem projeções quando existem violações de domínio.

### Validação profunda

A validação cobre:

- IDs duplicados;
- contas e batches inexistentes;
- moeda incompatível;
- mais de um snapshot da mesma conta no lote;
- políticas de reserva duplicadas;
- datas civis impossíveis;
- timestamps ISO UTC não canônicos;
- valores monetários inválidos;
- recorrências sem limite;
- transferências para a mesma conta;
- transferências cambiais não suportadas;
- referências quebradas.

### Forecast

O motor produz:

- forecast por conta;
- consolidado por moeda;
- composição separada em `confirmed`, `planned` e `estimated`;
- warnings de conta projetada negativa;
- warning explícito de granularidade diária;
- warning para evento planejado vencido;
- garantias estruturadas.

A soma dos saldos por conta reproduz o consolidado em cada data.

### Transferências

Uma transferência interna de mesma moeda é uma entidade única.

Efeito:

- origem: `-(amount + fee)`;
- destino: `+amount`;
- consolidado: `-fee`.

Transferência cambial é rejeitada nesta release.

### Decisões

Forecast e decisão são módulos separados.

Uma decisão:

- nunca usa forecast diferente de `COMPLETE`;
- exige política de reserva;
- usa a conta específica;
- pode retornar `SAFE`, `UNSAFE`, `INCOMPLETE` ou `INVALID`;
- não usa saldo consolidado para esconder insolvência da conta operacional.

### Datas

Datas civis `YYYY-MM-DD` são validadas por calendário real e manipuladas em UTC sem parsing local implícito.

### Importação

Foi adicionada a fundação de integridade para:

- hash dos bytes originais do ficheiro;
- fingerprint exato de linha;
- fingerprint semântico;
- classificação `ACCEPTED`, `REJECTED`, `EXACT_DUPLICATE` e `POSSIBLE_DUPLICATE`.

### Coordenação entre abas

Foi adicionada uma abstração pequena com `BroadcastChannel` e mensagens:

- `STATE_UPDATED`;
- `SYNC_STARTED`;
- `SYNC_SUCCEEDED`;
- `SYNC_CONFLICT`.

Não foi implementado merge automático.

## Validação executada

### TypeScript estrito dos novos módulos

Aprovado.

Comando equivalente:

```sh
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler   src/domain/model.ts   src/domain/dates.ts   src/domain/validation.ts   src/domain/forecast.ts   src/domain/decisions.ts   src/infrastructure/importIntegrity.ts   src/infrastructure/tabSync.ts   src/application/financialPipeline.ts   src/core/hash.ts
```

### Invariantes executáveis

Comando:

```sh
npm run verify:consolidation
```

Resultado observado:

```text
12/12 invariantes aprovados
```

Casos cobertos:

1. estado-base válido;
2. snapshot ausente retorna `INCOMPLETE`;
3. snapshots de outro lote não completam o lote selecionado;
4. transferência preserva consolidado salvo taxa;
5. soma por conta reproduz consolidado;
6. conta negativa gera warning com consolidado positivo;
7. evidências permanecem separadas;
8. data impossível retorna `INVALID`;
9. transferência cambial é rejeitada;
10. decisão exige forecast `COMPLETE`;
11. compra exige reserva;
12. limite até receita exige reserva.

## Limites honestos desta RC

Esta RC ainda não conclui toda a release de consolidação.

Ainda faltam:

- migração do schema persistido legado para o novo modelo;
- adaptação completa do `App.tsx` para usar o novo pipeline;
- revisão visual de importação;
- undo e proveniência integrados ao fluxo novo;
- backup pré-migração;
- integração do coordenador de abas ao ciclo de sincronização;
- painel técnico;
- testes de integração do pipeline completo;
- E2E em navegador;
- `npm ci`, Vitest e build Vite completos em ambiente com dependências instaladas.

O núcleo novo foi mantido isolado para não quebrar silenciosamente a aplicação legada antes da migração e integração estarem prontas.

## Próximo marco interno

O próximo marco deve ligar este contrato ao schema persistido:

1. criar schema v5;
2. implementar migração sequencial v4 → v5;
3. validar após migração;
4. criar backup antes de promover estado;
5. adaptar importação/reconciliação;
6. somente então substituir o forecast legado na UI.

Nenhuma nova funcionalidade de produto deve entrar antes disso.
