# Deploy da Alpha 8 no Vercel

## Variáveis do frontend

```text
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_ALLOWED_EMAIL=opcional
```

## Variáveis do servidor para a Auditoria Inteligente

```text
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
OPENAI_API_KEY=sk-...
OPENAI_FINANCIAL_MODEL=gpt-5.6-luna
```

Nunca use `VITE_OPENAI_API_KEY`. O Vite incorpora variáveis com prefixo `VITE_` no bundle público.

As rotas `/api/financial-audit` e `/api/financial-assistant` validam o bearer token do usuário no Supabase antes de chamar a OpenAI. O app continua funcional quando a chave da OpenAI não está configurada; apenas a Auditoria Inteligente e o Analista por IA ficam indisponíveis; perguntas determinísticas continuam locais.

## Banco de dados

A Alpha 8 usa `schemaVersion: 13` dentro do estado JSONB já existente. Não há migration SQL nova nesta entrega.

## Publicação

1. Substitua os arquivos do repositório pela pasta da Alpha 8.
2. Configure as variáveis acima no projeto Vercel.
3. Faça o deploy.
4. Abra o app uma vez online para que o service worker receba o cache `japa-finance-shell-alpha8`.
5. Exporte um backup antes de importar novamente os extratos.
