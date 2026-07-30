# Auditoria profunda de código — Japa Finance v0.7 RC14

Data: 30/07/2026

## Escopo executado

Auditoria e correção exclusivamente do código existente. Não foram executados `npm install`, build Vite, navegador/E2E ou conexão com Supabase real.

## Correções consolidadas nesta rodada

- O forecast agora exige início contíguo no dia posterior à reconciliação, impedindo que compromissos entre a reconciliação e o horizonte sejam ignorados.
- Saídas ainda pendentes até o dia lógico reconciliado entram de forma conservadora sem reaplicar rendas antigas.
- O limite até a próxima renda não desconta duas vezes obrigações carregadas para o primeiro dia do forecast.
- Compras e limites usam ordem intradiária conservadora quando não há horários dos eventos.
- Evidências estruturadas não exibem receitas ou transferências de entrada que o cálculo deliberadamente não considerou antes da fronteira intradiária.
- Backups rejeitam timestamps impossíveis em vez de normalizá-los silenciosamente para outra data.
- A normalização de movimentos importados usa aritmética monetária protegida.
- Motores financeiros legados duplicados foram removidos, deixando a fachada e o domínio como única rota de decisão.

## Verificações internas

- 16/16 invariantes de consolidação.
- 60/60 testes operacionais.
- 500 cenários determinísticos de conservação e consolidação.
- 1.000 decisões futuras aleatórias de compra.
- 500 decisões imediatas aleatórias.
- Arquitetura, sincronização estrutural, segurança estática e PWA estrutural aprovadas.

## Limites desta certificação

Esta entrega certifica apenas o código que pode ser compilado e executado isoladamente sem instalar dependências. Não certifica resolução das dependências npm, build Vite, comportamento do navegador, RLS real ou deploy.

## Parecer

Nenhum erro lógico P0/P1 conhecido permaneceu nos fluxos auditados de reconciliação, forecast, compra, limite até renda, recorrência, transferência, importação e restauração de estado. Isso não equivale à afirmação impossível de que software algum jamais terá defeitos; significa que a suíte e a inspeção desta rodada não deixaram defeito conhecido dentro do escopo declarado.
