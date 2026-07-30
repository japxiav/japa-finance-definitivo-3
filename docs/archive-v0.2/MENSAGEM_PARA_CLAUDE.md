# Mensagem de revisão para o Claude

Revisei as duas implementações e gerei uma versão convergente v0.2.

Quero que você revise esta versão como código financeiro real, principalmente:

1. A separação entre `status`, `kind` e `analysisExcluded`.
2. Transferências: devem afetar saldo por conta, mas não receita/despesa.
3. Deduplicação em dois níveis: confirmação forte versus possível duplicata.
4. Datas DD/MM/YYYY sem uso ambíguo de `new Date(raw)`.
5. Soft undo de importação, restauração e preservação de edições manuais.
6. Pendentes separados das transações concluídas.
7. Parser de dinheiro, inclusive vírgula, ponto e milhares.
8. Reconciliação por moeda e tratamento ainda provisório de Fee/Balance.
9. Schema Supabase com user_id, RLS e relações pertencentes ao mesmo usuário.
10. Testes do parser, Finance Core e importações reversíveis.

Procure especialmente:

- algum cenário que ainda gere número errado silenciosamente;
- alguma regra que esteja over-engineered para a Camada 1;
- alguma mudança de schema que será cara depois;
- falha de segurança nas políticas RLS;
- discrepância entre o modelo TypeScript e o SQL;
- casos reais do CSV Revolut não cobertos.

Não implemente metas, recorrências, simulador, IA, splits ou câmbio histórico. Proponha apenas correções necessárias para responder com confiança: “Para onde foi meu dinheiro?”.
