-- Japa Finance v0.3
-- Persistência privada por usuário. O aplicativo grava um snapshot JSONB
-- auditável e reversível; a modelagem normalizada permanece documentada como backlog.

create table if not exists public.app_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schema_version integer not null default 3,
  state jsonb not null,
  revision bigint not null default 1 constraint app_states_revision_positive check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_states_updated_at on public.app_states(updated_at);

create or replace function public.set_app_state_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.revision <> old.revision + 1 then
    raise exception 'app_states revision must increase by exactly one';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_states_updated_at on public.app_states;
create trigger trg_app_states_updated_at
before update on public.app_states
for each row execute function public.set_app_state_updated_at();

alter table public.app_states enable row level security;

revoke all on table public.app_states from anon;
grant select, insert, update, delete on table public.app_states to authenticated;

drop policy if exists "Users read own finance state" on public.app_states;
create policy "Users read own finance state"
on public.app_states
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Users create own finance state" on public.app_states;
create policy "Users create own finance state"
on public.app_states
for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Users update own finance state" on public.app_states;
create policy "Users update own finance state"
on public.app_states
for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Users delete own finance state" on public.app_states;
create policy "Users delete own finance state"
on public.app_states
for delete
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
