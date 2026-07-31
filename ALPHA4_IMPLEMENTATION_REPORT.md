# Japa Finance v0.9 Alpha 4 — Relatório de implementação

Data: 31/07/2026

## Objetivo

A Alpha 4 transforma o histórico em uma ferramenta de investigação e explicação, sem alterar o motor financeiro consolidado na Alpha 3. A entrega adiciona filtros avançados, regras em massa auditáveis, comparação equivalente entre períodos, explicações determinísticas, linha do tempo de alterações e exportação do conjunto filtrado.

## Funcionalidades entregues

### 1. Busca e filtros avançados

A tela de movimentações agora permite combinar:

- descrição, comerciante normalizado, nota, identificador bancário, tipo e produto bancário;
- conta e categoria;
- mês ou intervalo personalizado;
- valor mínimo e máximo;
- entrada ou saída;
- tipo técnico;
- origem da movimentação;
- somente itens pendentes de revisão.

Intervalos de data e valores inválidos são sinalizados. Exportação e criação de regras ficam bloqueadas até a correção. Quando um filtro não encontra resultados, a interface informa que não há correspondências em vez de sugerir uma nova importação.

### 2. Exportação CSV filtrada

A exportação usa exatamente as movimentações visíveis após os filtros. O arquivo inclui data, descrição, comerciante normalizado, conta, moeda, valor líquido, direção, tipo técnico, categoria, origem, status, revisão, identificadores bancários, produto e nota.

### 3. Regras de classificação em massa

Foi criado um modal com:

- correspondência exata, por início ou por conteúdo;
- categoria de destino;
- escopo opcional por direção e tipo técnico;
- prévia das movimentações afetadas;
- seleção individual de exceções;
- preservação de escolhas manuais;
- registro no histórico de decisões;
- desfazer com restauração das transações e da regra anterior.

As regras novas reutilizam a infraestrutura auditável já existente em `ReviewDecision` e `CategoryRule`.

### 4. Comparação entre períodos equivalentes

A tela Descobertas compara:

- entradas;
- despesas líquidas;
- resultado do fluxo.

O período anterior possui a mesma quantidade de dias do intervalo atual observado. Períodos parciais não são comparados silenciosamente com meses completos. Variações iguais a zero são mostradas como estabilidade, sem falso sinal de melhora.

### 5. Explicações determinísticas

A comparação produz textos calculados a partir dos próprios dados:

- aumento ou redução das despesas;
- categoria de maior impacto;
- melhora, piora ou estabilidade do fluxo.

Nenhuma explicação depende de IA ou atribui causalidade que os dados não comprovam.

### 6. Linha do tempo de alterações

A seção Mais agora reúne, em ordem cronológica:

- importações e anulações;
- classificações e desfazimentos;
- reconciliações e invalidações;
- compromissos planejados;
- movimentações manuais;
- categorias criadas ou arquivadas.

A linha do tempo é derivada do estado existente e respeita a moeda selecionada.

## Arquivos principais

Novos:

- `src/application/transactionFilters.ts`
- `src/analytics/comparison.ts`
- `src/application/activityTimeline.ts`
- `src/components/BulkRuleModal.tsx`
- `scripts/verify-alpha4.ts`

Alterados:

- `src/App.tsx`
- `src/classification/decisions.ts`
- `src/styles.css`
- `package.json`
- `public/sw.js`
- `README.md`
- `CHANGELOG.md`

## Compatibilidade de dados

- `schemaVersion` permanece em **8**.
- Nenhuma migração adicional foi necessária.
- Backups válidos da Alpha 3 continuam compatíveis.
- O filtro “Todo o histórico” continua dinâmico, usando a menor e a maior data concluída disponível para a moeda selecionada.

## Validação executada

### Typecheck direto do núcleo

Executado com `tsc --noEmit --strict` nos módulos novos e nas dependências financeiras centrais. Resultado: aprovado.

### Verificação estática da aplicação

Executado typecheck estático de `App.tsx`, dos componentes novos e de todo o diretório `src` com declarações temporárias para dependências externas. Resultado: aprovado.

### Smoke test determinístico Alpha 4

O script `scripts/verify-alpha4.ts` confirmou:

- combinação de filtros;
- exportação somente do conjunto filtrado;
- comparação e explicações;
- criação de regra `contains`;
- persistência de exceção;
- aplicação da regra em nova descrição compatível;
- desfazer restaurando transação e regra;
- geração da linha do tempo.

Resultado: aprovado.

### Smoke test com backup schema 8

Resultados principais:

- 281 movimentações em EUR lidas;
- histórico completo detectado de 22/05/2026 a 28/07/2026;
- comparação de 01/07–28/07 contra 03/06–30/06, com 28 dias em cada lado;
- 22 eventos derivados para a linha do tempo;
- CSV de amostra com cabeçalho e 20 movimentações.

Resultado: aprovado.

## Verificações deliberadamente não executadas

Conforme a regra definida para este projeto, não foram executados:

- `npm install` ou `npm ci`;
- Vitest;
- build do Vite;
- Supabase;
- testes E2E.

A entrega foi validada por compilação TypeScript direta, verificações estáticas e smoke tests determinísticos.
