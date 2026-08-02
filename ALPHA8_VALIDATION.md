# Validação da Alpha 8

Data: 02/08/2026  
Base: Alpha 7 + extratos reais Wise e Revolut

## Verificações executadas

### 1. Compilação estrita do núcleo

O TypeScript compilou, com `strict`, os novos motores e suas dependências:

- `relationshipIntelligence.ts`;
- `financialHistory.ts`;
- `financialAnalyst.ts`;
- `FinancialDecisionFacade.ts`;
- relacionamentos, memória, saúde, analytics, tipos, finanças, dinheiro e datas.

Resultado: **aprovado**.

### 2. Typecheck estrutural da interface

A aplicação inteira, partindo de `src/main.tsx`, foi verificada com stubs apenas para React, Supabase, Lucide e PDF.js. Isso valida imports internos, props, estados e ligações entre componentes sem instalar dependências.

Resultado: **aprovado**.

### 3. Transpilação sintática

Foram transpilados 97 arquivos `.ts` e `.tsx` de `src` e `api`.

Resultado: **0 erros sintáticos**.

### 4. Regressão da Alpha 7

O smoke test existente foi repetido com os extratos reais:

- 994 fatos;
- 221 transferências entre pessoas;
- 31 grupos de revisão de compras/despesas;
- 0 grupos de transferência;
- 9 relacionamentos EUR;
- 16 relacionamentos BRL;
- Hannah consolidada em 69 movimentos.

Resultado: **aprovado**.

### 5. Smoke test específico da Alpha 8

Foram validados:

- perfis mensais e cadência por relacionamento;
- insights automáticos de relacionamento;
- História Financeira não vazia;
- panorama de 11 meses;
- pergunta por primeiro nome;
- ranking de destinatários;
- primeiro uso da Revolut;
- compras, reembolsos e gasto líquido na Vinted;
- contexto da IA abaixo do limite de 220 kB;
- ausência de CSV bruto e IDs internos no panorama.

Resultado: **aprovado**.

### 6. Simulação da rota `/api/financial-assistant`

A chamada foi executada com fetch simulado:

- sessão Supabase validada;
- uma chamada à OpenAI;
- nenhuma ferramenta web;
- `store: false`;
- JSON Schema estrito;
- limite de 3.500 tokens de saída;
- retorno interpretativo sem ação executável.

Resultado: **aprovado**.

### 7. Regressão de privacidade da auditoria existente

A rota `/api/financial-audit` foi novamente verificada:

- chamada privada sem web;
- chamada pública com web;
- nome de pessoa particular ausente da chamada pública;
- `store: false` nas duas chamadas.

Resultado: **aprovado**.

### 8. Verificações estáticas existentes

Aprovadas:

- arquitetura;
- segurança;
- PWA;
- sincronização otimista;
- contrato estrutural do Supabase.

## Evidências numéricas

```text
schemaVersion: 13
fatos bancários: 994
transferências entre pessoas: 221
grupos obrigatórios de transferência: 0
relacionamentos: 9 EUR + 16 BRL
Hannah: 69 movimentos, cadência frequente
eventos da história EUR: 6
meses resumidos EUR: 11
contexto da IA: 10.915 bytes
```

Perguntas confirmadas:

```text
Quanto mandei para Hannah?
→ €1.928,51

Quem mais recebeu transferências minhas?
→ Hannah, €1.928,51 em 43 movimentos

Quando comecei a usar Revolut?
→ 22/05/2026

Quanto gastei na Vinted?
→ €1.012,41 em compras
→ €129,52 em reembolsos
→ €882,89 líquidos
```

## O que não foi validado

Não houve execução de:

- npm;
- Vitest;
- Vite build;
- navegador ou iPhone real;
- Supabase remoto;
- Vercel;
- chamada real à OpenAI;
- teste E2E.

Portanto, a lógica, os contratos e a integração interna foram validados, mas o deploy ainda precisa do teste visual e operacional do usuário.
