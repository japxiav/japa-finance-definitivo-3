# Japa Finance — melhorias convergentes para revisão do Claude

Este documento compara a primeira implementação do GPT com os arquivos `financeCore.js`, `revolut.js`, `financeCore.test.js` e `schema.sql` produzidos pelo Claude.

## Bloqueadores corrigidos na v0.2

### 1. Separar estado, natureza financeira e exclusão analítica
Antes, transferência era representada como `excluded`, o que a retirava também do saldo da conta.

Agora existem conceitos independentes:

- `status`: completed, pending, voided ou merged;
- `kind`: income, expense, transfer, refund, adjustment ou unknown;
- `analysisExcluded`: omite de análises sem reescrever o fato bancário.

Transferências afetam os saldos das contas, mas não aparecem como receita ou despesa.

### 2. Nunca somar moedas diferentes
O Finance Core agora retorna saldos por conta e por moeda. O dashboard exige uma moeda selecionada. Não existe conversão implícita.

### 3. Deduplicação com dois níveis
- ID bancário igual ou mesma linha do mesmo arquivo: duplicata confirmada.
- Fingerprint semelhante sem prova forte: possível duplicata, apresentada ao usuário.

Duas compras legítimas iguais no mesmo dia recebem ocorrências diferentes e não são apagadas.

### 4. Datas bancárias explícitas
O parser não usa `new Date(raw)` em formatos ambíguos. São aceitos formatos declarados, como DD/MM/YYYY e YYYY-MM-DD. Formato desconhecido vira erro.

### 5. Desfazer lote sem apagar dados
Desfazer importação agora faz soft void, mantém o lote e permite restauração. Antes da ação, a UI informa quantas transações têm edição manual, nota ou transferência vinculada.

### 6. Pendentes fora dos fatos concluídos
Linhas pendentes ficam numa coleção separada durante a prévia. Elas não são inseridas como transações incompletas incompatíveis com o schema.

### 7. Parser monetário rigoroso
Aceita vírgula e ponto decimal, separadores de milhar e parênteses. Rejeita valor vazio, texto inválido e números fora do limite seguro.

### 8. Normalização conservadora
Acentos são normalizados, mas números internos são preservados. `7-Eleven` continua identificável; somente sufixos longos de terminal são removidos.

### 9. Campos bancários preservados
Type, Product, State, Fee e Balance são preservados em campos canônicos e no `originalData`. Taxas são marcadas para revisão até validarmos um CSV real.

### 10. Segurança do Supabase
O schema inclui `user_id`, Row Level Security, políticas de proprietário e índices de deduplicação e revisão.

## Melhorias ainda necessárias antes de produção

1. Validar o parser com um CSV real e anonimizado do Revolut.
2. Confirmar semanticamente se `Amount` já inclui `Fee` em cada tipo de operação.
3. Testar a reconciliação com extratos reais, inclusive quando faltam linhas.
4. Implementar persistência Supabase sem permitir acesso direto da UI às fórmulas do Finance Core.
5. Criar processo de importação do backup JSON e testar uma restauração completa.
6. Criar UI específica para ligar os dois lados de uma transferência.
7. Adicionar fusão entre lançamento manual e transação bancária quando lançamentos manuais entrarem.
8. Adicionar auditoria de nota, exclusão analítica e vínculo de transferência, não apenas categoria e tipo.
9. Fixar versões das dependências depois da primeira instalação validada.
10. Rodar testes no CI antes de cada deploy.

## O que não deve entrar ainda

- metas;
- contas recorrentes;
- simulador de compra;
- IA;
- câmbio histórico;
- splits;
- diário;
- gamificação;
- offline e sincronização complexa.

A Camada 1 termina quando responde, com dados reconciliados e pendências visíveis: **“Para onde foi meu dinheiro?”**
