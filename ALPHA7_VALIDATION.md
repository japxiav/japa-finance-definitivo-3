# Validação da Alpha 7

## Verificações executadas

### Transpilação sintática

Foram transpilados, pela API do TypeScript, 101 arquivos `.ts` e `.tsx` de `src`, `api` e `scripts`.

Resultado: sem erro de sintaxe.

### Typecheck estrutural da aplicação

A árvore React/API foi verificada com declarações temporárias para dependências externas ausentes no ZIP.

Resultado: sem referência interna ausente ou incompatibilidade estrutural detectada.

Essa verificação não substitui o typecheck real com `node_modules` instalados.

### Compilação estrita do núcleo

O script `scripts/verify-alpha7.ts` e suas dependências foram compilados com:

- `strict`;
- ES2022;
- CommonJS temporário;
- bibliotecas ES2023 e DOM.

Resultado: compilação concluída.

### Smoke test com extratos reais

Fontes usadas:

- Revolut, 22/05/2026 a 01/08/2026;
- Wise BRL, 07/10/2025 a 01/08/2026;
- Wise EUR, 07/10/2025 a 01/08/2026.

Resultado principal:

```json
{
  "schemaVersion": 13,
  "transactions": 994,
  "personTransfers": 221,
  "reviewGroups": 31,
  "transferGroups": 0,
  "eurRelationships": 9,
  "brlRelationships": 16,
  "contextSuggestions": 6,
  "timelineEvents": 9,
  "categorizedExpenseCents": 248244,
  "transferOutflowCents": 99820,
  "transferInflowCents": 516847
}
```

## Invariantes confirmadas

- nenhuma transferência entre pessoas virou grupo de revisão;
- transferências migradas ficam com categoria não aplicável;
- `uncategorized` e `ambiguous_transfer` antigos são removidos das transferências;
- outras razões de revisão permanecem;
- compras/despesas fecham exatamente com a soma das categorias;
- transferências enviadas e recebidas permanecem separadas das categorias de consumo;
- Hannah foi consolidada em uma relação com múltiplos aliases e 69 movimentos no conjunto testado;
- sugestões opcionais de contexto ficaram limitadas a seis;
- clicar numa relação pode usar os IDs exatos de todas as suas movimentações;
- diagnóstico não trata transferência sem contexto como desconhecida;
- auditoria determinística não cria propostas `create_memory_entity` em massa;
- o panorama da auditoria contém relacionamentos agregados;
- duas ocorrências históricas da mesma série recorrente foram anualizadas apenas uma vez;
- backup schema 12 migrou para schema 13 sem manter revisão apenas por ausência de categoria.

## Verificações não executadas

Não foram executados:

- `npm install`;
- build do Vite;
- Vitest;
- navegador real;
- PWA instalada no iPhone;
- Supabase remoto;
- Vercel real;
- chamada real à OpenAI;
- E2E.

Portanto, a entrega está validada por compilação direta, análise estrutural e smoke tests do núcleo, mas ainda precisa do teste manual de interface após o deploy.
