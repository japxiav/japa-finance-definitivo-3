# Japa Finance v0.9 Alpha 1 — Relatório da arquitetura de classificação

## Objetivo concluído

A implementação atual torna a importação e a revisão utilizáveis antes de avançar para recursos analíticos mais ambiciosos.

```text
CSV
→ normalização
→ identificação técnica
→ agrupamento
→ sugestões
→ revisão
→ regras
→ insights
```

## Decisões de domínio

### Tipo técnico separado da categoria financeira

`Transaction.kind` continua representando o fato técnico bancário:

- `income`;
- `expense`;
- `transfer`;
- `refund`;
- `adjustment`;
- `unknown`.

`Transaction.categoryId` agora é opcional. Ausência de categoria não significa erro técnico e não impede cálculos, previsões ou analytics.

A antiga categoria persistida `uncategorized` foi removida. “Sem categoria” continua disponível apenas como agrupamento sintético em filtros, métricas e insights.

### Grupos de revisão

`ReviewGroup` reúne movimentações por:

- comerciante normalizado;
- moeda;
- direção;
- tipo técnico.

Cada grupo mantém as movimentações relacionadas, estado pendente ou adiado e uma sugestão opcional com confiança, pontuação, explicação e evidências.

### Regras e exceções

Regras aprendidas podem ser limitadas por:

- moeda;
- direção;
- tipo técnico.

Uma regra pode guardar IDs de exceções individuais. Decisões manuais continuam prevalecendo sobre classificações automáticas.

### Histórico e desfazer

Cada decisão de revisão registra:

- transações afetadas;
- estado anterior e posterior da classificação;
- trilha de edição manual;
- regra criada ou substituída.

O desfazer restaura o estado anterior sem apagar o histórico da decisão.

## Interface implementada

A tela de revisão agora oferece:

- cartões por grupo;
- sugestão explicável;
- seleção em massa;
- exclusão de movimentações do lote;
- categoria individual para exceções;
- criação opcional de regra;
- “Resolver depois”;
- reabertura de grupos adiados;
- desfazer a última decisão.

A prévia de importação separa tipos identificados, transferências internas, reembolsos, grupos sem categoria e pendências técnicas.

## Persistência e compatibilidade

O estado foi migrado para `schemaVersion: 6`.

A migração:

- remove a categoria artificial `uncategorized`;
- converte essas referências em categoria ausente;
- preserva categorias personalizadas;
- mantém regras válidas;
- inicializa grupos e histórico de decisões;
- reconstrói os grupos a partir das transações atuais.

## Arquivos centrais alterados

### Domínio e persistência

- `src/core/types.ts`
- `src/core/storage.ts`
- `src/data/defaults.ts`
- `src/core/merchant.ts`

### Pipeline de classificação

- `src/core/csv.ts`
- `src/classification/technicalClassifier.ts`
- `src/classification/categoryCompatibility.ts`
- `src/classification/grouping.ts`
- `src/classification/decisions.ts`

### Interface

- `src/App.tsx`
- `src/components/ReviewGroupsPanel.tsx`
- `src/styles.css`

### Consumidores analíticos

- `src/core/finance.ts`
- `src/analytics/metrics.ts`
- `src/insights/engine.ts`

## Verificações realizadas

- transpilação sintática de 58 arquivos TypeScript e TSX em `src` e `scripts`;
- verificação estrita de tipos do domínio, persistência, parser, classificação, finanças, métricas e insights;
- verificação de compatibilidade dos 48 arquivos-fonte da aplicação com declarações externas isoladas para React, Supabase, Lucide e PDF.js;
- smoke test funcional do motor de classificação cobrindo agrupamento, sugestão por histórico, aplicação parcial, exceção individual, regra com escopo, desfazer e adiamento de grupo;
- busca estática por referências antigas incompatíveis com `schemaVersion: 6`, categoria artificial `uncategorized` e expectativas legadas nos testes.

Não foram executados npm, Vitest, build do Vite, Supabase ou E2E nesta etapa.

## Fora do escopo atual

O roadmap posterior não foi implementado nesta versão. Permanecem para depois da estabilização do fluxo de classificação:

- linha do tempo financeira;
- mudanças de comportamento;
- perfil financeiro automático;
- relação entre eventos;
- árvore de causas;
- simulador;
- extrato próprio em PDF e CSV;
- comparação entre períodos;
- pesquisa inteligente;
- gestão avançada de regras em massa;
- detecção automática de padrões;
- motor determinístico de explicações mais amplo;
- IA opcional para conversa e resumo;
- notificações e alertas.
