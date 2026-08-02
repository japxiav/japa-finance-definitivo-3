# Japa Finance Alpha 7 — Relationship Engine

Entrega: `0.9.0-alpha.7`  
Estado persistido: `schemaVersion: 13`  
Base: Alpha 6

## Decisão de produto

A Alpha 7 elimina a obrigação de explicar transferências entre pessoas. Uma transferência bancária já é um fato financeiro completo quando o app conhece direção, valor, moeda e contraparte. Categoria, finalidade e relação pessoal passam a ser enriquecimentos opcionais.

Fluxo adotado:

```text
fato bancário
→ tipo técnico
→ contraparte
→ relacionamento financeiro
→ contexto opcional
→ insight
```

## Implementação

### 1. Transferências não criam revisão de categoria

`incoming_transfer`, `outgoing_transfer`, `internal_transfer` e `currency_conversion` usam `categoryReviewStatus: not_applicable`.

A migração 12 → 13 remove apenas as razões antigas:

- `uncategorized`;
- `ambiguous_transfer`.

Outras razões legítimas continuam intactas, e decisões manuais não são sobrescritas.

### 2. Relationship Engine

Novo módulo: `src/application/financialRelationships.ts`.

Ele:

- extrai contrapartes de campos estruturados e descrições bancárias;
- agrupa transferências recebidas e enviadas da mesma pessoa;
- preserva todos os aliases bancários encontrados;
- consolida, de forma conservadora, nomes abreviados e completos;
- calcula total enviado, recebido, líquido, contagens e intervalo;
- ranqueia relacionamentos por relevância;
- limita sugestões opcionais de contexto a seis;
- deriva uma linha do tempo de mudanças observáveis sem inventar motivos.

A consolidação não une pessoas apenas por primeiro e último nome. O nome abreviado precisa ser compatível com os tokens do nome completo.

### 3. Painel Relacionamentos Financeiros

Novo componente: `src/components/FinancialRelationshipsPanel.tsx`.

Inclui:

- pessoas para quem mais foi enviado dinheiro;
- pessoas de quem mais foi recebido dinheiro;
- mapa completo de relações;
- busca e filtros por direção;
- enviado, recebido e saldo da relação;
- primeira e última ocorrência;
- contexto opcional;
- linha do tempo;
- acesso às movimentações exatas do relacionamento.

Clicar num relacionamento filtra pelos IDs reais que o compõem, em vez de depender apenas de busca textual. Isso preserva nomes abreviados, como variações bancárias da Hannah.

### 4. Contexto por relacionamento

O contexto é armazenado em `financialMemory`, mas não altera:

- valor;
- data;
- moeda;
- tipo técnico;
- saldo;
- fluxo.

Todos os aliases consolidados são salvos na entidade. O contexto pode ser removido e o estado é reprocessado com checkpoint.

### 5. Transferências fora das categorias de despesa

As métricas de consumo agora separam:

- compras, taxas e outras despesas categorizáveis;
- transferências enviadas;
- transferências recebidas.

Transferências para pessoas não participam mais de:

- categorias de despesas;
- comerciantes principais;
- gasto por dia da semana;
- gasto por horário;
- ticket médio;
- maior despesa;
- dias sem gasto;
- comparação de “compras e despesas”.

Elas continuam participando do fluxo externo, porque dinheiro realmente entrou ou saiu da conta.

### 6. Home e fluxo explicável

A Home ganhou o painel de principais relacionamentos.

O detalhamento do fluxo mostra separadamente:

- compras e despesas;
- transferências enviadas;
- transferências recebidas;
- reembolsos;
- internas e conversões;
- despesas sem categoria.

### 7. Revisão simplificada

A revisão não cria grupos para transferências entre pessoas. O bloco de contexto é mostrado apenas como opção em Relacionamentos, sem somar pendências críticas.

### 8. Insights e auditoria alinhados

Foram removidos comportamentos que recriavam trabalho manual por outra porta:

- ausência de contexto pessoal não gera insight de alerta;
- diagnóstico não chama transferência sem finalidade de “desconhecida”;
- auditoria determinística não cria propostas para ensinar cada pessoa;
- o prompt da auditoria por IA declara que contexto de transferência é opcional;
- o panorama de IA recebe relacionamentos agregados, não uma fila de pessoas a classificar.

### 9. Recorrências sem anualização absurda

Itens recorrentes equivalentes são agrupados por pessoa, rótulo e frequência. Apenas a versão mais recente de cada série entra no cálculo mensal/anual. O histórico inteiro não é somado como se cada pagamento passado fosse uma nova assinatura ativa.

### 10. Interface móvel

Foram adicionados estilos para:

- painel de relacionamentos;
- rankings;
- sugestões opcionais;
- diretório e pesquisa;
- cartões de relação;
- timeline;
- contexto em folha/modal;
- resumo na Home;
- filtro exato de relacionamento nas movimentações;
- adaptação para telas estreitas e safe area.

### 11. PWA e documentação

- cache atualizado para `japa-finance-shell-alpha7`;
- pacote atualizado para `0.9.0-alpha.7`;
- README, changelog e instruções de deploy atualizados;
- não há migration SQL nova.

## Limites conscientes

- o app só cria uma relação quando o extrato fornece nome ou descrição útil da contraparte;
- valores de moedas diferentes não são somados entre si;
- o mesmo relacionamento aparece no painel da moeda selecionada, embora o contexto salvo possa ser reutilizado em outras moedas;
- o app não adivinha se uma transferência foi empréstimo, assinatura ou ajuda. Esse detalhe permanece opcional;
- OpenAI continua opcional e não participa dos cálculos financeiros.
