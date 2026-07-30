-- Japa Finance v0.7 operational closure
-- Aligns persisted schema metadata and reasserts private ownership policies.

alter table public.app_states
  alter column schema_version set default 4;

alter table public.app_states enable row level security;
alter table public.app_states force row level security;

revoke all on table public.app_states from anon;
grant select, insert, update, delete on table public.app_states to authenticated;

drop policy if exists "Users read own finance state" on public.app_states;
create policy "Users read own finance state"
on public.app_states for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users create own finance state" on public.app_states;
create policy "Users create own finance state"
on public.app_states for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own finance state" on public.app_states;
create policy "Users update own finance state"
on public.app_states for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own finance state" on public.app_states;
create policy "Users delete own finance state"
on public.app_states for delete to authenticated
using ((select auth.uid()) = user_id);

comment on table public.app_states is
  'Private per-user Japa Finance state. Access is restricted by auth.uid() RLS policies.';
