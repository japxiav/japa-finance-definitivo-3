# Japa Finance v0.9 Alpha 9 — Compreensão Financeira

A Alpha 9 reúne em um único produto o núcleo financeiro determinístico, a central de conhecimento, explicações auditáveis, memória comportamental, objetos financeiros, auditoria contínua, recuperação e uma camada opcional de IA.

O princípio continua simples:

> O extrato bancário é a fonte dos fatos. Regras, memória e IA apenas organizam, explicam e levantam hipóteses.

## O que entrou

1. **Motor de conhecimento** — grafo derivado de contas, instituições, pessoas, comerciantes, categorias e objetos financeiros.
2. **Motor de explicação** — cálculos importantes mostram fórmula, escopo, movimentos incluídos, exclusões, evidências e confiança.
3. **Qualidade dos dados** — score geral, dimensões e qualidade por conta.
4. **Auditoria contínua** — duplicatas, tipos desconhecidos, regras conflitantes, conversões incompletas, reembolsos sem vínculo e transferências internas sugeridas.
5. **História financeira ampliada** — mudanças observáveis, recorrências e objetos aparecem na timeline.
6. **Insights contextuais** — mudanças, impacto, consequência e evidências, sem transformar percentuais óbvios em poesia corporativa.
7. **Memória comportamental** — renda típica, faixa de gastos, relações e comerciantes recorrentes podem ser confirmados ou ignorados.
8. **Detecção de mudanças** — comparação entre períodos equivalentes de 30 dias, por consumo, renda, pessoa, comerciante e recorrência.
9. **Objetos financeiros** — assinatura, empréstimo, apoio familiar, viagem, compra grande, meta, reserva, compromisso e projeto.
10. **Eventos compostos** — conversão, taxa, transferência interna e compra/reembolso aparecem como acontecimentos ligados, sem apagar as linhas bancárias.
11. **Onboarding e importação guiada** — explicação do fluxo antes da primeira importação e prévia obrigatória.
12. **Segurança visível** — sessão, cofre remoto, isolamento, sincronização e estado da IA são exibidos sem promessas impossíveis.
13. **Recuperação de desastre** — backups JSON e checkpoints locais comprimidos, com migração e restauração validadas.
14. **Interface adaptativa** — novas páginas roláveis, safe area, teclado do iPhone, modais e cartões responsivos.
15. **IA opcional e subordinada** — recebe um panorama já calculado; não lê CSV bruto, não altera o estado e não vira contadora por entusiasmo.

## Estado e migração

- Versão do aplicativo: `0.9.0-alpha.9`
- Estado persistido: `schemaVersion: 15`
- Backups schema 14 são migrados automaticamente.
- Não há migration SQL nova nesta entrega.
- Objetos financeiros, memória comportamental e onboarding ficam no JSONB já existente.

## Navegação

- **Início** — posição, Hoje, dinheiro livre e visão diária.
- **Movimentos** — fatos bancários, filtros e detalhes auditáveis.
- **Planejar** — compromissos, reserva e projeções.
- **Insights** — análises, História Financeira, Perguntar aos Números, Central de Compreensão e IA opcional.
- **Mais** — contas, revisão, saúde da base, relacionamentos, segurança e recuperação.

## OpenAI opcional

O aplicativo financeiro funciona sem chave da OpenAI. Para habilitar os recursos explicitamente marcados como IA, configure no Vercel:

```text
OPENAI_API_KEY=...
OPENAI_FINANCIAL_MODEL=gpt-5.6-luna
```

A chave permanece nas rotas de servidor em `api/`. Não use prefixo `VITE_` para segredos.

## Variáveis essenciais

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
```

Consulte `.env.example` e `VERCEL_DEPLOY.md`.

## Validação executada nesta entrega

- compilação TypeScript estrita do núcleo financeiro e das migrações;
- typecheck estrutural de toda a aplicação com declarações temporárias de dependências;
- verificadores de arquitetura, sincronização, segurança e PWA;
- migração do backup real schema 14 para 15, preservando 994 movimentos e 5 contas;
- smoke test dos novos motores sobre o backup real;
- checkpoint comprimido criado e restaurado com as 994 movimentações.

Não foram executados npm, Vitest, Vite build, navegador real, Supabase remoto, Vercel real nem chamada real à OpenAI. O deploy continua sendo a validação final da interface e do bundle com as dependências reais.
