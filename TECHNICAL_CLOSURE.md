# Fechamento técnico — Japa Finance v0.6

Data: 2026-07-27  
Escopo: webapp pessoal, estado local com sincronização Supabase.

## Resultado implementado

A versão passa a ter um núcleo financeiro determinístico mínimo. O estado persistente foi migrado do schema 3 para o schema 4 e inclui:

- `AccountBalanceSnapshot`: saldo explícito por conta, data-base, origem e estado de reconciliação;
- `ReservePolicy`: reserva mínima persistente por moeda;
- `PlannedEvent`: receitas, despesas, parcelas, transferências e recorrências futuras;
- `ForecastResult`: projeção diária de saldo;
- simulação de saída única sem mutar o estado real;
- cálculo do valor disponível até à próxima receita prevista.

Arquivos centrais:

- `src/core/types.ts`
- `src/core/forecast.ts`
- `src/core/assistant.ts`
- `src/core/storage.ts`
- `src/core/forecast.test.ts`
- `src/core/assistant.test.ts`

## Integração no webapp

A tela de contas/dados recebeu ações básicas para:

- registar um snapshot reconciliado;
- configurar a reserva mínima da moeda selecionada;
- criar um evento financeiro futuro.

O assistente recebe o estado financeiro completo, e não apenas transações. A mensagem de auditoria da UI agora mostra o escopo dos dados utilizado, evitando declarar que uma resposta de saldo foi baseada no filtro visual de movimentos.

A pergunta “Quanto posso gastar até o pagamento?” possui implementação própria. O cálculo exige:

1. snapshots reconciliados para todas as contas ativas da moeda;
2. uma receita futura cadastrada nos 90 dias;
3. política de reserva persistida;
4. eventos futuros ativos da moeda.

## Regras de decisão

Para uma compra simulada na data atual:

`menor saldo projetado após a compra - reserva mínima`

- resultado maior ou igual a zero: cabe na projeção conhecida;
- resultado negativo: viola a reserva;
- conta ativa sem snapshot: resposta recusada;
- reserva não configurada: resposta recusada;
- moedas são calculadas separadamente.

O motor não usa LLM para contas. O parser continua simples e a camada de linguagem apenas seleciona operações determinísticas.

## Migração e compatibilidade

`normalizeState()` aceita backups schema 2, 3 e 4.

- schema 2 e 3 são migrados para schema 4;
- novas coleções são inicializadas vazias;
- valores monetários, datas, referências de conta e listas obrigatórias recebem validação;
- nenhum compromisso futuro é inventado durante a migração.

Consequência: após atualizar, o utilizador precisa cadastrar snapshots, reserva e eventos futuros para obter respostas de projeção.

## Validações executadas

### Compilação isolada do domínio

Executado com TypeScript em modo estrito para:

- tipos;
- dinheiro;
- finanças;
- previsão;
- assistente;
- armazenamento.

Resultado: aprovado.

### Testes executáveis do motor

12 cenários executados diretamente em Node:

- seleção do snapshot mais recente;
- deteção de conta sem saldo;
- despesa antes de receita;
- limite até à próxima receita;
- simulação imutável;
- isolamento de moeda;
- evento fora do intervalo;
- recorrência semanal;
- recorrência mensal com preservação do dia-base;
- término de recorrência;
- intervalo inválido;
- valor de simulação negativo;
- ausência de próxima receita.

Resultado: 12/12 aprovados.

### Verificação estrutural de sincronização

Executado:

`node scripts/verify-sync-structure.mjs`

Resultado: 11/11 verificações aprovadas.

### Sintaxe da interface

`src/App.tsx` foi transpilado com o compilador TypeScript para validação sintática.

Resultado: aprovado.

## O que não foi validado

Não foi possível executar:

- `npm install`;
- `npm test`;
- `npm run build`;
- testes end-to-end em navegador.

Motivo: este ambiente não possui acesso ao registo npm e o projeto não contém `node_modules` nem `package-lock.json`.

Portanto, não há confirmação de integração completa do bundle React, Vitest ou Supabase nesta sessão.

## Limitações remanescentes

1. A interface de cadastro financeiro usa diálogos nativos do navegador. É funcional, mas provisória.
2. Recorrências podem ser processadas pelo motor, mas ainda não possuem formulário próprio na UI.
3. Parcelas existem como tipo de evento, mas falta um assistente de criação de série de parcelas.
4. Snapshots importados ainda não são criados automaticamente ao concluir uma importação; o saldo deve ser registado manualmente.
5. O horizonte do assistente está fixado em 90 dias.
6. Não há previsão estatística de gastos variáveis.
7. Transferências futuras não fazem conversão cambial nem pareamento entre contas.
8. O parser de linguagem continua baseado em padrões e números escritos em algarismos.
9. `App.tsx` permanece grande e deve ser refatorado.
10. Não há testes E2E nem validação real em múltiplas abas.

## Riscos técnicos

- Um evento futuro omitido continua produzindo uma projeção incompleta.
- Um snapshot manual incorreto contamina todo o forecast.
- A confiança atual reflete pendências de importação e completude de saldo, mas não mede qualidade estatística.
- A sincronização remota armazena o estado v4 no mesmo documento; a migração SQL não foi alterada porque a coluna remota já contém o estado serializado.
- A ausência de lock entre abas continua aberta.

## Próximos incrementos recomendados

1. Criar snapshots automaticamente a partir do saldo final confirmado de cada importação.
2. Substituir os prompts por formulários tipados para saldo, reserva, receita, despesa e recorrência.
3. Criar gerador de parcelas e calendário financeiro.
4. Adicionar edição, cancelamento e histórico de eventos planejados.
5. Implementar testes E2E para importação, sincronização, projeção e compra simulada.
6. Separar `App.tsx` em páginas, hooks e serviços de domínio.
7. Adicionar fallback opcional de LLM apenas para classificação de intenção, mantendo os cálculos no motor determinístico.

## Conclusão técnica

A v0.6 implementa a primeira camada necessária para decisões financeiras: estado reconciliado persistente, políticas, eventos futuros, forecast diário e simulação. Isso corrige a lacuna arquitetural principal da v0.5.

Não considero o webapp pronto para decisões financeiras de produção sem executar o build completo, os testes Vitest e testes E2E. Também não considero a previsão completa enquanto snapshots e eventos futuros dependerem de cadastro manual e não houver interface de revisão adequada.
