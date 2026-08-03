# Deploy da Alpha 9 no Vercel

## Caminho recomendado

1. Substitua o conteúdo do repositório pelo projeto completo da Alpha 9.
2. Confirme que `src/application/knowledgeEngine.ts` e os demais módulos novos chegaram ao GitHub.
3. Faça commit e push na branch ligada ao Vercel.
4. Acompanhe a execução de `npm run build` no log do deploy.
5. Abra o aplicativo online uma vez para atualizar o service worker para `japa-finance-shell-alpha9`.

O pacote completo é preferível ao patch. Depois do arquivo ausente da Alpha 8, confiar que dezenas de arquivos chegaram por telepatia seria uma escolha de produto curiosa.

## Variáveis obrigatórias

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
```

## IA opcional

```text
OPENAI_API_KEY=...
OPENAI_FINANCIAL_MODEL=gpt-5.6-luna
```

Sem `OPENAI_API_KEY`, o núcleo, os insights determinísticos, a memória, a timeline e a auditoria contínua continuam funcionando. Apenas as ações explícitas de interpretação por IA ficam indisponíveis.

## Banco de dados

A Alpha 9 usa `schemaVersion: 15` no estado JSONB existente. Não há migration SQL nova. Backups schema 14 são migrados automaticamente no carregamento.

## Primeira abertura

- usuários que já possuem movimentos não veem onboarding obrigatório;
- contas novas recebem onboarding curto e importação guiada;
- backups e pontos de recuperação ficam em **Mais → Segurança e recuperação**;
- a nova central fica em **Insights → Central de compreensão**.
