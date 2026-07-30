# Japa Finance — Contrato Técnico v0.2

## Propósito
Responder com confiança: **“Para onde foi meu dinheiro?”**

## Constituição
1. Os dados pertencem ao usuário e devem ser exportáveis.
2. O banco guarda fatos, origem, estado e correções; o Finance Core produz interpretações.
3. Todo cálculo financeiro existe numa única camada de funções puras.
4. Mudanças preservam dados, compatibilidade e reversibilidade.
5. Escolhas manuais vencem automações sem apagar o dado original.
6. O app demonstra o que sabe, o que supõe e o que falta.
7. Complexidade precisa se pagar. YAGNI.
8. Cada camada termina quando responde uma pergunta completa.

## Três dimensões de uma transação

### Estado
- `completed`: fato concluído;
- `pending`: ainda não definitivo;
- `voided`: anulado sem exclusão física;
- `merged`: incorporado a outro registro.

### Natureza financeira
- `income`;
- `expense`;
- `transfer`;
- `refund`;
- `adjustment`;
- `unknown`.

### Inclusão analítica
`analysisExcluded` permite retirar uma movimentação de relatórios sem alterar o saldo bancário.

## Regras financeiras
- Transferência afeta saldo por conta, mas não receita/despesa.
- Reembolso reduz gasto, não vira salário.
- Moedas nunca são somadas sem conversão explícita.
- Transações voided, pending e merged não entram em cálculos concluídos.
- O dashboard seleciona uma moeda por vez.

## Autoridade dos dados
1. Fato original do banco.
2. Correção manual do usuário.
3. Regra automática.
4. IA futura, apenas como explicação ou sugestão.

## Deduplicação
- ID bancário ou mesma linha do mesmo arquivo: confirmação forte.
- Fingerprint sem prova forte: possível duplicata para revisão.
- Nada é descartado silenciosamente por heurística.

## Importação
- prévia obrigatória;
- parser versionado;
- datas analisadas por formato explícito;
- pendentes separados;
- reconciliação por moeda quando a coluna Balance permite;
- lote anulável e restaurável;
- edições manuais sobrevivem à reimportação.

## Critério de pronto
- Duas compras iguais legítimas não são fundidas.
- O mesmo arquivo reimportado não duplica.
- Possíveis duplicatas ficam visíveis.
- DD/MM/YYYY não sofre inversão de mês e dia.
- Transferências não contaminam gastos.
- Moedas permanecem separadas.
- Desfazer lote não apaga edições silenciosamente.
- Totais batem com um extrato real conhecido.
- Backup JSON preserva os dados essenciais.
- Testes do Finance Core e parser passam.
