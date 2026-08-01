# Japa Finance v0.9 Alpha 5.3.1 — Patch de usabilidade e contexto Wise

## Correções entregues

### 1. Exclusão de compromissos
- Adicionado botão de excluir em cada evento futuro da tela Planejar.
- Adicionado botão de excluir também em eventos sem conta.
- A exclusão é reversível pelo checkpoint local criado antes da ação.
- O evento é desativado no histórico, deixa de participar do forecast e sai das pendências.
- Se o compromisso veio de um detalhamento de transferência, o detalhamento econômico é preservado, mas o vínculo com a previsão é removido.

### 2. Frases portuguesas da Wise
O classificador agora reconhece:
- “Enviou dinheiro para …” como transferência enviada.
- “Recebeu dinheiro de …” como transferência recebida.
- Equivalentes em inglês “sent money to” e “received money from”.

### 3. Identidade própria
Descrições como “Recebeu dinheiro de Diogo Patrick …” passam a ser reconhecidas como transferência interna quando a identidade própria corresponde.

### 4. Agrupamento por contraparte
O normalizador remove os prefixos verbosos da Wise e agrupa por pessoa, por exemplo:
- “Enviou dinheiro para Emily …” → grupo “Emily …”.
- “Recebeu dinheiro de Diogo …” → identidade própria / transferência interna.

### 5. Taxas explícitas da Wise
- Taxas incluídas no valor líquido continuam sem gerar um segundo lançamento, evitando cobrança dupla.
- Mesmo assim, agora aparecem no resumo de taxas por instituição e no custo explícito das conversões.

### 6. Cabeçalho móvel
- Cabeçalho passa a usar grid rígido.
- Seletor de moeda e avatar ficam contidos na mesma linha do nome do aplicativo.
- Regras defensivas impedem posicionamento flutuante herdado.

## Migração
- Estado interno: schemaVersion 10 → 11.
- Migração automática ao abrir o app.
- Nenhuma migration SQL do Supabase foi alterada.
- Decisões manuais de tipo técnico continuam soberanas e não são sobrescritas.

## Validação executada
- 70 arquivos TypeScript/TSX: zero erros de sintaxe.
- Compilação TypeScript estrita dos módulos alterados e dependências financeiras: aprovada.
- Smoke test de migração 10 → 11: aprovado.
- “Recebeu dinheiro de Diogo Patrick” → internal_transfer, excluído da análise e sem revisão.
- “Enviou dinheiro para Emily” → outgoing_transfer e agrupamento por contraparte.
- Exclusão de compromisso: evento desativado e detalhamento desvinculado.
- Taxa Wise incluída: contabilizada na análise sem duplicar o movimento.

Não foram executados npm, Vite, Vitest, Supabase ou E2E.
