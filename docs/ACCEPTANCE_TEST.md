# Teste de aceitação com extrato real

Para cada uma das quatro contas:

1. Selecione a conta correta antes de importar.
2. Importe um CSV de apenas um mês.
3. Não permita importação parcial na primeira tentativa.
4. Confira todas as pendências apresentadas.
5. Compare com o banco:
   - número de linhas;
   - moeda;
   - total de entradas;
   - total de saídas;
   - saldo final;
   - transferências;
   - reembolsos;
   - taxas.
6. Exporte um backup JSON.
7. Anule o lote e confirme que as transações desaparecem dos relatórios, mas continuam no histórico.
8. Restaure o lote.
9. Restaure o backup JSON em seguida.

Qualquer diferença, mesmo de um centavo, deve virar um teste antes da correção.

## Teste obrigatório de dois dispositivos

1. Abra o mesmo usuário em dois navegadores ou aparelhos.
2. Confirme que ambos mostram a mesma revisão inicial.
3. Desconecte o aparelho A e crie uma transação manual.
4. No aparelho B, crie outra transação e aguarde “Salvo na nuvem”.
5. Reconecte ou recarregue o aparelho A.
6. Confirme que aparece “Conflito de sincronização protegido”.
7. Baixe o backup local.
8. Escolha uma das versões e confirme que a outra foi preservada em checkpoint.
9. Reabra os dois aparelhos e confira que ambos convergiram para a revisão escolhida.

Falha crítica: qualquer versão desaparecer sem tela de conflito.
