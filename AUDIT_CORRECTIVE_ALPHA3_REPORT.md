# Japa Finance v0.9 Alpha 3 — Relatório corretivo da auditoria

Data: 31/07/2026

## Escopo

Esta entrega corrige as inconsistências encontradas ao comparar a Alpha 2, o backup real de 30/07/2026 e as telas do iPhone. O objetivo não foi ampliar o roadmap, mas tornar importação, reconciliação e apresentação do fluxo coerentes entre si.

## Diagnóstico confirmado

A tela mostrava `-€133,71` porque o filtro visual “Todos” alimentava a lista completa, enquanto `buildAnalytics` recebia intervalo indefinido e aplicava silenciosamente os últimos 30 dias. A soma daquele subconjunto estava coerente com os dados então persistidos, mas o contexto apresentado era incorreto.

Além disso, o backup continha:

- 10 comissões no campo `Comissão`, totalizando €11,24;
- €2,20 dessas comissões entre 29/06/2026 e 28/07/2026;
- duas operações `REVERTIDA`, Chatgpt (€1,00) e Uber (€21,00), gravadas como concluídas;
- dois livros de saldo Revolut em EUR, `Atual` e `Poupanças`, tratados como uma única sequência na prévia;
- dois reembolsos antigos pendentes de vínculo fora do intervalo de 30 dias, mas capazes de marcar a análise atual como provisória.

## Correções implementadas

### 1. “Todos” agora significa histórico completo

Quando o mês selecionado é `all`, o aplicativo deriva explicitamente a menor e a maior data concluída da moeda selecionada. O mesmo intervalo é enviado para:

- lista e atividades recentes;
- métricas;
- insights;
- assistente determinístico;
- cartão de fluxo.

O intervalo exato aparece na interface.

### 2. Fluxo deixou de fingir que é saldo

O cartão passou a usar:

- `Entradas externas`;
- `Saídas externas líquidas`;
- `Resultado do fluxo`.

A expressão “O que sobrou” foi removida. O texto explica que fluxo é a soma dos movimentos analíticos do período e não a posição bancária final.

### 3. Comissões do Revolut viram fatos próprios

O parser agora reconhece `Comissão` e `Commission`. Quando a taxa é adicional ao valor reportado, cria uma movimentação filha:

- `sourceComponent: fee`;
- `technicalType: bank_fee`;
- `kind: expense`;
- vínculo por `feeOfTransactionId`;
- efeito financeiro negativo independente;
- mesma conta, moeda, produto e data da linha de origem.

Isso permite excluir uma conversão cambial sem apagar sua comissão. Para formatos como Wise, nos quais o valor exportado já é líquido, a taxa não é duplicada.

### 4. Operações revertidas têm efeito zero

Estados bancários `REVERTIDA`, `REVERTIDO`, `reversed`, `reversal` e equivalentes recebem:

- `status: reverted`;
- `netMovementCents: 0`;
- nenhuma categoria financeira;
- nenhuma pendência de revisão.

A linha continua visível para auditoria, com o valor original riscado e a indicação “revertida”.

### 5. Reconciliação por livro bancário

A prévia agora agrupa por `moeda + produto`, e não apenas moeda. Assim, `EUR · Atual` e `EUR · Poupanças` são reconciliados separadamente.

### 6. Pendências são limitadas ao período exibido

Uma pendência só torna o fluxo provisório quando a transação vinculada pertence ao intervalo em análise. Pendências históricas continuam na revisão, mas não rebaixam a confiança de outro período.

### 7. Migração para schema 8

A migração v7 → v8:

- cria fatos de comissão determinísticos;
- converte estados revertidos;
- restaura o movimento primário ao valor reportado antes de separar a taxa;
- preserva categorias, regras, decisões e demais dados;
- reconstrói os grupos de revisão;
- valida o vínculo entre taxa e movimentação de origem.

Também foi corrigida a validação de timestamps bancários locais canônicos, que eram produzidos pelo próprio parser, mas recusados pelo restaurador de backup.

## Resultado numérico com o backup real

### Intervalo antigo da tela: 29/06/2026 a 28/07/2026

| Componente | Valor |
|---|---:|
| Entradas externas | €1.109,47 |
| Saídas externas brutas, incluindo €2,20 de taxas | €1.245,38 |
| Reembolsos | €0,00 |
| Resultado correto do fluxo | **-€135,91** |

O valor anterior de `-€133,71` estava €2,20 acima porque as comissões daquele intervalo não haviam sido importadas.

### Histórico completo: 22/05/2026 a 28/07/2026

| Componente | Valor |
|---|---:|
| Entradas externas | €4.172,47 |
| Despesas e saídas externas | €3.427,21 |
| Reembolsos | €35,58 |
| Resultado do fluxo histórico | **€780,84** |

Esse €780,84 não é o saldo final. O movimento bancário total da conta, incluindo transferências internas e conversões excluídas da análise, fecha em **€0,00**, exatamente como o extrato.

## Smoke tests executados

Sem npm, Vitest, Vite, Supabase ou E2E:

- transpilação sintática de 54 arquivos TypeScript/TSX: 0 erros;
- typecheck estrito do núcleo, persistência, classificação, métricas e insights: aprovado;
- migração do backup real: schema 8, 281 fatos;
- 10 fatos de taxa, total €11,24;
- 2 fatos revertidos, ambos com movimento líquido zero;
- reconstrução das 271 linhas do CSV: 271 linhas importadas e 281 fatos produzidos;
- `EUR · Atual`: reconciliação com diferença €0,00;
- `EUR · Poupanças`: reconciliação com diferença €0,00;
- reimportação do mesmo conteúdo com hash diferente: 271 linhas marcadas como possíveis duplicatas, sem taxa órfã e sem fato novo silencioso.

## Arquivos principais alterados

- `src/core/types.ts`
- `src/core/csv.ts`
- `src/core/storage.ts`
- `src/core/csv.test.ts`
- `src/core/storage.test.ts`
- `src/core/finance.ts` foi preservado como consumidor de `netMovementCents`
- `src/App.tsx`
- `src/insights/engine.ts`
- `src/data/defaults.ts`
- `src/styles.css`
- `public/sw.js`
- `package.json`
- `README.md`
- `CHANGELOG.md`

## Limite da validação

A integração visual foi revisada estaticamente, mas não houve build completo do aplicativo porque npm, Vite e dependências externas foram excluídos do escopo por decisão do projeto.

**Confiança:** alta no parser, migração, cálculos e reconciliação; médio-alta na integração visual até a prévia da Vercel ser aberta no iPhone.
