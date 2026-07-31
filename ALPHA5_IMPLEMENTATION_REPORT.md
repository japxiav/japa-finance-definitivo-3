# Japa Finance v0.9 Alpha 5 — Relatório de implementação

## Objetivo

A Alpha 5 transforma o aplicativo de uma leitura principalmente histórica em uma ferramenta orientada ao presente: saldo atual, contas e instituições separadas, planejamento até a próxima receita, transferências com finalidade econômica e descobertas que levam a uma ação concreta.

## Escopo entregue

### 1. Saldo atual e confiabilidade

- Card de saldo atual na Home.
- Consolidação por moeda sem apagar a origem de cada conta.
- Saldos individuais por conta e instituição.
- Estados de confiabilidade: `confirmed`, `estimated`, `stale` e `missing`.
- Data da última confirmação disponível.
- Ponte explicativa entre:
  - saldo inicial;
  - fluxo externo;
  - transferências internas e conversões;
  - taxas;
  - ajustes;
  - saldo final.
- Resumo das movimentações do dia.

O saldo atual é calculado a partir do snapshot reconciliado completo mais recente e das movimentações posteriores. Na ausência de reconciliação suficiente, o aplicativo informa que o saldo está ausente ou estimado, em vez de apresentar precisão fictícia.

### 2. Dinheiro realmente livre e planejamento

- Nova área **Planejar**.
- Cálculo de dinheiro livre:
  - saldo atual;
  - menos compromissos até a próxima receita;
  - menos reserva mínima protegida.
- Próxima receita e próximo compromisso.
- Limite diário seguro quando os dados permitem.
- Expansão correta de eventos recorrentes, inclusive quando a data-base já passou.
- Compromissos recorrentes considerados até a próxima ocorrência de receita.

### 3. Wise, Revolut, contas e moedas

- Instituição, conta, produto, moeda e origem do arquivo permanecem separados.
- Visão consolidada por moeda sem fundir Wise e Revolut no domínio.
- Filtros por instituição e conta.
- Contas-padrão Wise EUR e Wise BRL podem ser ativadas no gerenciador.
- Resumos por instituição com:
  - entradas;
  - saídas;
  - taxas explícitas;
  - conversões;
  - quantidade de contas e movimentos.
- Importação Wise preserva o tratamento líquido do arquivo e não cria taxa sintética duplicada.

### 4. Transferências entre contas próprias

Novo conciliador de possíveis transferências internas entre contas, inclusive Wise ↔ Revolut.

A sugestão usa:

- valores opostos iguais;
- mesma moeda;
- contas diferentes;
- proximidade de até três dias;
- evidências na descrição.

Ao confirmar:

- as duas pontas permanecem no ledger;
- recebem o mesmo `transferGroupId`;
- são marcadas como `internal_transfer`;
- deixam de contar como receita ou despesa externa;
- continuam alterando os saldos das contas envolvidas.

Também é possível rejeitar a sugestão, e a decisão fica registrada.

### 5. Transferências com finalidade econômica

Nova ação **Detalhar transferência**.

Uma transferência pode ser dividida em itens contendo:

- descrição;
- valor;
- finalidade;
- categoria;
- pessoa relacionada;
- observação;
- recorrência;
- frequência;
- próxima data;
- compromisso planejado opcional.

A soma dos itens deve fechar exatamente com o valor do lançamento bancário. O fato original não é alterado nem fragmentado no ledger.

Isso permite representar, por exemplo, uma única transferência contendo Netflix compartilhada, mercado e reembolso, sem classificar todo o valor como uma categoria genérica.

Itens recorrentes podem gerar compromissos planejados sem duplicação e são removidos ou desativados corretamente quando a recorrência deixa de existir.

### 6. Analytics conscientes do detalhamento

- Totais por categoria consideram os itens detalhados dentro de transferências.
- Busca pode encontrar descrição, pessoa, observação e finalidade dos itens.
- Filtro por categoria entende o detalhamento econômico.
- Transferências já detalhadas não são oferecidas indevidamente como pares internos automáticos.

### 7. Descobertas acionáveis

A tela foi dividida em:

- **Agora**: riscos ou pendências que exigem atenção;
- **Oportunidades**: possíveis economias ou melhorias;
- **Padrões**: observações históricas e comportamentais.

O novo motor de impacto pode apontar:

- saldo ausente, estimado ou desatualizado;
- dinheiro livre negativo;
- limite diário seguro;
- possíveis transferências internas;
- transferências externas ainda sem finalidade;
- recorrências escondidas em transferências;
- taxas por instituição.

A Home mostra apenas uma descoberta prioritária, evitando transformar o painel principal num depósito de cartões.

Também foram corrigidos textos imprecisos:

- “Compras” passou a “Movimentações” quando o contexto não é compra;
- “Boa sequência sem despesas” passou a informar dias sem gastos registrados;
- linguagem causal foi reduzida em padrões após receitas;
- ações usam textos menores e contextuais.

### 8. Estrutura visual com comportamento de aplicativo

- Shell com cinco áreas:
  - Início;
  - Movimentos;
  - Planejar;
  - Descobertas;
  - Mais.
- Cabeçalho compacto.
- Navegação inferior fixa.
- Apenas a área central rola.
- Safe areas do iPhone.
- Seletor de moeda e avatar integrados ao layout, sem sobrepor os cartões.
- Modais adaptados para comportamento de folha em telas menores.
- Home resumida, com detalhe sob demanda.

### 9. Estabilidade e prevenção de tela preta

- `AppErrorBoundary` global no ponto de entrada.
- Tela de recuperação segura quando ocorre erro de renderização.
- A recuperação não apaga os dados locais.
- Mutações de categoria e tipo técnico usam trava por movimentação.
- Salvamentos usam atualização funcional de estado.
- Exceções dentro do próprio atualizador de estado preservam o estado anterior e geram mensagem visível.
- A trava é liberada por `queueMicrotask`, reduzindo cliques ignorados sem permitir mutações concorrentes.
- Todos os 14 arquivos TSX foram verificados e nenhum botão ficou com tipo implícito:
  - ações comuns usam `type="button"`;
  - envios de formulário usam `type="submit"`.

Essas medidas reduzem o risco observado de tela preta e botões inconsistentes. Elas não constituem prova absoluta contra falhas específicas de navegador ou dispositivo.

## Schema e compatibilidade

O estado passou para `schemaVersion: 9`.

Novas estruturas:

- `TransactionAllocation`;
- `TransferPurpose`;
- `InternalTransferDecision`;
- `transactionAllocations`;
- `internalTransferDecisions`.

A migração `v8 → v9`:

- preserva transações e fatos bancários;
- inicializa as novas coleções;
- mantém taxas e operações revertidas;
- permite restaurar o backup schema 8 usado na Alpha 4.

Validações adicionais impedem:

- item detalhado com valor inválido;
- categoria ou movimentação inexistente;
- soma de itens diferente do lançamento original;
- decisão de transferência interna estruturalmente inválida.

## Validação executada

### Compilação semântica da aplicação

Todos os arquivos não-teste de `src` foram compilados com TypeScript estrito e stubs temporários apenas para dependências externas de UI.

Resultado:

- sem erros de propriedades, imports internos ou tipos do domínio;
- `noImplicitAny` foi desligado somente nessa passagem porque os stubs leves de JSX não fornecem tipagem contextual completa para eventos inline.

### Compilação estrita do núcleo

Passaram com `--strict`:

- tipos e migração;
- defaults;
- storage;
- posições de conta;
- analytics cambial;
- métricas;
- conciliação de transferências internas;
- filtros;
- motor de impacto.

Resultado: **0 erros**.

### Verificação de sintaxe

- 71 arquivos TS/TSX de `src` e `scripts` analisados;
- 0 erros de sintaxe.

### Smoke test funcional

Usando o backup real schema 8 corrigido:

- 281 fatos preservados;
- 10 taxas preservadas;
- 2 operações revertidas preservadas;
- migração para schema 9 aprovada;
- ausência de saldo reconciliado tratada honestamente;
- total explícito de taxas preservado em €11,24;
- contas Wise e Revolut permanecem separadas e consolidam corretamente;
- ponte do saldo aprovada;
- dinheiro livre e limite diário aprovados;
- recorrência com data-base passada encontra a próxima receita;
- sugestão, confirmação e rejeição de transferência interna aprovadas;
- detalhamento por finalidade e pessoa aprovado;
- soma inválida bloqueada;
- filtros conscientes dos itens aprovados;
- transferência já detalhada excluída de sugestão interna;
- CSV Wise sintético reconhecido como `wise_csv`;
- instituição e conta preservadas;
- nenhuma taxa adicional duplicada no Wise.

Resultado: **Alpha 5 smoke verification passed**.

### Verificação estática de interface

Passaram:

- Error Boundary no ponto de entrada;
- shell com cinco áreas;
- saldo atual e ponte financeira;
- filtros Wise/Revolut;
- detalhamento de transferências;
- revisão de transferências internas;
- descobertas acionáveis;
- planejamento;
- 14 arquivos TSX sem botão de tipo implícito.

## Limites honestos da validação

Por decisão do projeto, não foram executados:

- npm;
- Vitest;
- build do Vite;
- Supabase;
- E2E.

Também não foi realizado teste interativo em Safari/iPhone ou navegador real. Portanto, não é correto afirmar que todo botão está matematicamente garantido contra qualquer falha de dispositivo. O que foi confirmado é:

- consistência estática;
- compilação do domínio e da aplicação;
- fluxos centrais em smoke test reproduzível;
- ausência de botões HTML com tipo implícito;
- proteção global contra falha de renderização;
- proteção das mutações que estavam associadas ao relato de tela preta.

## Arquivos de verificação incluídos

- `scripts/verify-alpha5.ts`
- `scripts/verify-alpha5-ui.mjs`

Eles permitem repetir as verificações sem depender da infraestrutura ignorada por padrão no projeto.
