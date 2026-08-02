# Japa Finance v0.9 Alpha 6 — Relatório de implementação

Data: 02/08/2026  
Base: `0.9.0-alpha.5.3.1`  
Entrega: `0.9.0-alpha.6`  
Estado persistido: `schemaVersion: 12`

## Resumo executivo

A Alpha 6 implementa o ciclo discutido na auditoria: o extrato bancário permanece como fonte imutável dos fatos, enquanto classificação, vínculos, contexto, insights e propostas de IA ficam em camadas separadas e auditáveis.

O foco não foi adicionar mais um mural de gráficos. O foco foi impedir que um número apareça sem explicar sua origem, reduzir revisão falsa, preservar decisões manuais e preparar o aplicativo para aprender contexto sem entregar o livro-caixa a um modelo probabilístico.

A implementação alterou 41 arquivos em relação à Alpha 5.3.1 e acrescentou módulos para livros bancários, ciclo de vida de importação, eventos compostos, Saúde da Base, Memória Financeira e Auditoria Inteligente.

## Correção importante sobre o cartão Hoje

A auditoria anterior havia afirmado que o `-€50,40` de 01/08/2026 não existia no extrato. Isso estava errado. O extrato Revolut contém três débitos concluídos naquele dia:

- linha bancária A: `-€21,13`
- linha bancária B: `-€19,27`
- linha bancária C: `-€10,00`

Total concluído: `-€50,40`.

Existe ainda um débito pendente no Dunnes Stores de `-€7,10`.

Portanto, o valor do app não era inventado. O defeito real era não mostrar a composição e não separar concluído de pendente. A Alpha 6 corrige exatamente isso.

## As 22 correções

### 1. Livros por produto bancário

**Implementado.** A identidade de conta considera instituição, moeda e produto. O importador separa:

- Revolut Atual EUR;
- Revolut Atual BRL;
- Revolut Poupanças EUR;
- Wise EUR, Conta principal;
- Wise BRL, Conta principal.

Movimentos relacionados a Rende+ recebem contexto de produto interno sem fabricar uma posição bancária inexistente.

Arquivos principais: `src/application/accountBooks.ts`, `src/core/csv.ts`, `src/core/storage.ts`.

### 2. Movimentações pendentes armazenadas

**Implementado.** Linhas pendentes deixam de virar apenas um aviso de importação e passam a existir no livro com `status: pending`.

O saldo contabilizado usa fatos concluídos. O saldo disponível incorpora o impacto pendente separadamente.

Arquivos principais: `src/core/csv.ts`, `src/analytics/accountPositions.ts`.

### 3. Reimportação como enriquecimento

**Implementado.** O mesmo identificador bancário não é mais descartado automaticamente. O importador compara o fato existente e pode atualizar:

- pendente para concluído;
- pendente para revertido;
- campos bancários ausentes;
- taxa e metadados novos;
- data bancária final.

Categoria, nota e decisões manuais são preservadas.

Arquivos principais: `src/core/csv.ts`, `src/core/imports.ts`.

### 4. Reconhecimento de Wise Charges

**Implementado.** Descrições `Wise Charges for:` e IDs `FEE-BALANCE-*` são classificados como `bank_fee`.

Nos extratos reais usados na validação, os desconhecidos técnicos da Wise caíram para zero.

Arquivo principal: `src/classification/technicalClassifier.ts`.

### 5. Eventos compostos

**Implementado.** Linhas bancárias continuam imutáveis, mas podem ser ligadas num único acontecimento:

- conversão;
- taxa relacionada;
- pontas de origem e destino;
- transferência entre contas próprias.

Isso evita analisar três linhas como três decisões financeiras independentes.

Arquivos principais: `src/application/compoundEvents.ts`, `src/analytics/currencyAnalytics.ts`.

### 6. Rende+ sem saldo fictício

**Implementado parcialmente por desenho conservador.** O app reconhece movimento para/de Rende+ como interno e o exclui do fluxo externo. Ele não declara um saldo próprio do produto sem extrato, posição ou reconciliação confiável.

Essa limitação é intencional. Contexto pode ser inferido; patrimônio não.

### 7. Cartão Hoje rastreável

**Implementado.** O cartão separa:

- entradas externas concluídas;
- saídas externas concluídas;
- transferências internas;
- conversões;
- taxas;
- pendentes.

Cada bloco contém os IDs usados e pode abrir as movimentações correspondentes.

Arquivo principal: `src/application/todayActivity.ts`.

### 8. Zero diferente de desconhecido

**Implementado na posição e interface principal.** Saldo pode ser exibido como:

- confirmado;
- estimado;
- desatualizado;
- incompleto;
- não informado;
- zero confirmado.

Pendência não transforma ausência de dados em `0,00`.

### 9. Reconciliação automática pelo extrato

**Implementado.** Quando a prévia fecha por produto e fornece saldo final confiável, a confirmação da importação pode criar snapshots reconciliados na data do extrato.

O app não chama uma posição antiga de saldo ao vivo.

Arquivos principais: `src/App.tsx`, `src/application/reconciliation.ts`, `src/core/csv.ts`.

### 10. Revisão obrigatória versus organização opcional

**Implementado.** A revisão foi dividida em:

1. Corrigir dados;
2. Confirmar vínculos;
3. Ensinar contexto;
4. Organizar categorias.

Categoria ausente continua sendo oportunidade de organização, não falha matemática.

### 11. Interface móvel de movimentações

**Implementado estruturalmente e em CSS.** Campos deixam de disputar largura no cartão. A lista apresenta o resumo; os detalhes completos abrem numa folha inferior.

Arquivos principais: `src/components/TransactionDetailsSheet.tsx`, `src/styles.css`.

**Limite de validação:** a estrutura foi typechecked, mas não houve execução visual em Safari/iPhone nesta entrega.

### 12. Descrição humana e dado bruto

**Implementado.** O app gera títulos amigáveis como taxa da Wise, transferência interna e movimento Rende+, preservando a descrição original e os campos brutos em detalhes expansíveis.

Arquivo principal: `src/application/transactionPresentation.ts`.

### 13. Contadores coerentes

**Implementado na nova hierarquia de revisão e Saúde da Base.** A interface separa contagens obrigatórias, vínculos, contexto e categorias opcionais. A Saúde da Base deriva verificações do mesmo estado financeiro.

A implementação elimina o uso de um único número gigantesco que misturava problemas de natureza diferente.

### 14. Importador sem destino enganoso

**Implementado.** A ação principal passa a ser `Importar extrato bancário`. A conta escolhida é apresentada como fallback apenas para formatos genéricos.

A prévia mostra instituição, moeda, produto, destino, linhas novas e atualizações antes da confirmação.

### 15. Gerenciamento completo de contas

**Implementado.** É possível:

- renomear;
- arquivar;
- reativar;
- excluir conta vazia;
- mesclar contas da mesma moeda;
- criar conta com produto;
- preservar e mover vínculos relacionados durante a mesclagem.

Arquivo principal: `src/application/accountManagement.ts`.

### 16. Home compacta

**Implementado.** O cabeçalho conceitual foi reduzido. A prioridade visual passa a ser:

- saldo contabilizado;
- saldo disponível após pendentes;
- posição e data;
- atividade de hoje;
- dinheiro livre e próximos compromissos.

### 17. Insights acionáveis

**Implementado no filtro do motor.** Insights puramente decorativos ou óbvios são removidos. Uma descoberta precisa aumentar compreensão, revelar mudança relevante, mostrar impacto ou apoiar uma decisão.

Arquivos principais: `src/insights/actionability.ts`, `src/insights/engine.ts`, `src/insights/impactEngine.ts`.

### 18. Memória Financeira

**Implementado.** O estado pode guardar entidades com:

- nome e aliases;
- tipo;
- relação;
- papel financeiro;
- categoria e tipo técnico sugeridos;
- direção;
- período de validade;
- origem e evidência.

Assim, uma pessoa conhecida pode ser intermediária de salário em um período específico sem fazer toda transferência futura recebida dela virar salário.

Arquivo principal: `src/application/financialMemory.ts`.

### 19. IA propõe, motor aplica

**Implementado.** A IA devolve propostas estruturadas. Antes de aplicar, o aplicativo:

- valida tipo de ação;
- verifica IDs e compatibilidade;
- protege decisões manuais;
- mostra mudanças e bloqueios;
- cria checkpoint;
- aplica pelo motor determinístico;
- registra a proposta como aplicada.

Arquivos principais: `src/application/auditActions.ts`, `src/components/AuditProposalConfirmModal.tsx`.

### 20. Pesquisa externa restrita

**Implementado em duas etapas.** A auditoria privada é executada sem ferramenta web. Quando o usuário habilita pesquisa, uma segunda chamada recebe somente `publicLookupCandidates`, derivados de pagamentos a possíveis comerciantes ou empresas.

Nomes de transferências, pessoas da Memória Financeira e dados bancários pessoais não são enviados para a chamada que possui a ferramenta de busca.

A rota também usa `store: false` e nunca expõe a chave no bundle do navegador.

Arquivos principais: `api/financial-audit.ts`, `src/application/smartAudit.ts`.

### 21. Saúde da Base concreta

**Implementado.** A tela verifica:

- duplicatas fortes;
- tipos técnicos desconhecidos;
- pendentes;
- taxa com direção incompatível;
- conversões incompletas;
- contas sem posição reconciliada;
- problemas de importação;
- grupos opcionais;
- registro do último backup.

O score é resumo. As verificações e seus IDs continuam visíveis.

Arquivo principal: `src/application/dataHealth.ts`.

### 22. Navegação reorganizada

**Implementado.** A interface expõe Início, Movimentos, Planejar, Insights e Mais. Saúde da Base, Revisão, Contas, Importações, Memória Financeira e Auditoria ficam acessíveis de forma explícita.

## Arquitetura da IA

A aplicação funciona sem OpenAI. Quando habilitada:

1. o frontend constrói um panorama financeiro estruturado;
2. a rota Vercel valida a sessão Supabase;
3. a auditoria privada recebe o panorama sem acesso à web;
4. opcionalmente, uma segunda chamada recebe somente candidatos públicos a comerciante e pode pesquisar;
5. ambas retornam JSON validado por schema;
6. o frontend transforma a resposta em propostas;
7. nenhuma proposta altera o estado sem prévia e confirmação.

Variáveis necessárias no servidor:

```text
OPENAI_API_KEY=...
OPENAI_FINANCIAL_MODEL=gpt-5.6-luna
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
```

A chave da OpenAI não usa prefixo `VITE_`.

## Validações executadas

### TypeScript do aplicativo

Executado `tsc --noEmit` sobre todos os arquivos `src/**/*.ts` e `src/**/*.tsx`, usando stubs locais apenas para dependências externas já conhecidas.

Resultado: **aprovado**.

### Rota de IA

Executado `tsc --noEmit` sobre `api/financial-audit.ts`.

Resultado: **aprovado**.

### Extratos reais

Arquivos usados:

- Wise BRL, 07/10/2025 a 01/08/2026;
- Wise EUR, 07/10/2025 a 01/08/2026;
- Revolut, 22/05/2026 a 01/08/2026.

Resultado do smoke test principal:

```json
{
  "transactionCount": 979,
  "wiseUnknown": 0,
  "pending": 1,
  "todayExternalNetCents": -5040,
  "todayPendingNetCents": -710,
  "revolutImported": 332
}
```

Livros detectados:

- Revolut Atual EUR;
- Revolut Atual BRL;
- Revolut Poupanças EUR;
- Wise EUR;
- Wise BRL.

### Reimportação

Resultado:

```json
{
  "firstImported": 332,
  "duplicateReimport": 347,
  "newTransactionsOnIdenticalReimport": 0,
  "updatesOnIdenticalReimport": 0,
  "lifecycleUpdate": "pending → completed",
  "manualCategoryPreserved": "groceries"
}
```

### Migração schema 11 para 12

Resultado:

```json
{
  "schemaVersion": 12,
  "savingsBook": "Revolut Poupanças EUR",
  "savingsRows": 19,
  "wisePatternsResolved": 119,
  "newCollectionsInitialized": true
}
```

### Rota de IA e isolamento da pesquisa web

A rota foi executada com `fetch` simulado, sem chamada externa paga. O teste confirmou duas etapas independentes:

```json
{
  "status": 200,
  "openAiCalls": 2,
  "privateCallHasWebTool": false,
  "publicCallHasWebTool": true,
  "storeDisabled": true,
  "privateNameSentToWebCall": false
}
```

## O que não foi executado

Por decisão de escopo e conforme a regra vigente do projeto, não foram executados:

- `npm install`;
- build Vite;
- Vitest;
- navegador real;
- Safari/iPhone;
- Supabase remoto;
- Vercel real;
- chamada paga à OpenAI;
- E2E.

Portanto, a entrega tem validação estrutural e determinística forte, mas ainda precisa do deploy para confirmar renderização real, variáveis de ambiente e comportamento da rota serverless.

## Banco de dados

Não há migration SQL nova. O estado continua no JSONB existente e migra internamente para `schemaVersion: 12`.

## Recomendação de primeiro uso

1. Baixar um backup da versão atual.
2. Publicar a Alpha 6.
3. Abrir o app e confirmar a migração.
4. Importar os extratos corretos.
5. Verificar Saúde da Base.
6. Conferir o cartão Hoje e abrir sua composição.
7. Só então começar a ensinar contexto e habilitar a auditoria por IA.

## Conclusão

A Alpha 6 não torna o aplicativo magicamente infalível. Ela faz algo mais importante: cria mecanismos para demonstrar quando o dado fecha, quando não fecha, por que um número existe e qual camada tomou cada decisão.

É a primeira versão em que o app começa a assumir o trabalho de auditoria em vez de empurrá-lo de volta para o usuário com uma elegante coleção de cartões provisórios.
