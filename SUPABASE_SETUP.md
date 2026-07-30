# Supabase Setup

## 1. Criar e ligar o projeto

No painel do Supabase, copie o **Project reference** em Settings → General. A URL e a chave **publishable** ficam em Settings → API.

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase db push
```

As migrations devem ser aplicadas nesta ordem:

1. `001_initial_schema.sql`
2. `002_optimistic_concurrency.sql`
3. `003_operational_closure.sql`

Não use `service_role`, `sb_secret` ou a senha do banco no Vite.

## 2. Auth

Em Authentication → Providers, mantenha Email habilitado. Configure a URL pública da Vercel como Site URL e adicione URLs de preview somente quando necessárias.

## 3. Ambiente local

```bash
cp .env.example .env.local
```

Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. `VITE_ALLOWED_EMAIL` é opcional.

## 4. Teste RLS real com duas contas

Crie duas contas de teste normais e execute:

```bash
SUPABASE_URL=... \
SUPABASE_PUBLISHABLE_KEY=... \
RLS_USER_A_EMAIL=... RLS_USER_A_PASSWORD=... \
RLS_USER_B_EMAIL=... RLS_USER_B_PASSWORD=... \
npm run test:rls
```

O script não precisa de chave administrativa. Ele valida leitura própria e bloqueio de leitura, atualização, exclusão e inserção forjada pelo segundo utilizador.


## Acesso pessoal obrigatório (migration 004)

Depois de `supabase db push`, adicione o único e-mail autorizado pelo SQL Editor:

```sql
insert into public.allowed_emails (email)
values (lower('seu-email@exemplo.com'))
on conflict (email) do nothing;
```

A tabela não concede acesso a `anon` ou `authenticated`. As políticas de `app_states`
exigem simultaneamente o e-mail na allowlist e `auth.uid() = user_id`. Sem esse registro,
a autenticação pode ocorrer, mas o banco recusa leitura e gravação do estado financeiro.

Também desative novos cadastros em **Authentication → Providers → Email** depois de
criar a conta pessoal, caso não precise mais de signup.
