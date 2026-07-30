# Segurança

## Senha

A senha é enviada diretamente do formulário para o Supabase Auth por HTTPS. O Japa Finance não a grava em `AppState`, no banco financeiro, em logs ou no código-fonte.

## Chaves

O frontend usa apenas `VITE_SUPABASE_PUBLISHABLE_KEY` ou a chave `anon` legada. Essas chaves identificam o projeto, mas não ignoram as políticas RLS.

Nunca use no navegador:

- `service_role`;
- `sb_secret_...`;
- senha do banco Postgres.

## Dados

A tabela `public.app_states` tem uma linha por usuário. As políticas exigem que `auth.uid()` seja igual ao `user_id` em SELECT, INSERT, UPDATE e DELETE.

## Limitação

O projeto usa autenticação e isolamento de banco, não criptografia ponta a ponta. O proprietário do projeto Supabase possui controle administrativo sobre a infraestrutura. Para um app pessoal em projeto próprio, isso é esperado; não anuncie a terceiros como cofre de conhecimento zero.
