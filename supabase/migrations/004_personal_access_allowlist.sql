-- Japa Finance v0.7 RC6
-- Enforces personal access in the database. Populate this table through the
-- Supabase SQL editor or another privileged channel before using the app.

create table if not exists public.allowed_emails (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint allowed_emails_normalized check (email = lower(trim(email)) and position('@' in email) > 1)
);

alter table public.allowed_emails enable row level security;
alter table public.allowed_emails force row level security;
revoke all on table public.allowed_emails from anon, authenticated;

create or replace function public.current_user_is_allowed()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.allowed_emails
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.current_user_is_allowed() from public, anon;
grant execute on function public.current_user_is_allowed() to authenticated;

drop policy if exists "Users read own finance state" on public.app_states;
create policy "Users read own finance state"
on public.app_states for select to authenticated
using (public.current_user_is_allowed() and auth.uid() = user_id);

drop policy if exists "Users create own finance state" on public.app_states;
create policy "Users create own finance state"
on public.app_states for insert to authenticated
with check (public.current_user_is_allowed() and auth.uid() = user_id);

drop policy if exists "Users update own finance state" on public.app_states;
create policy "Users update own finance state"
on public.app_states for update to authenticated
using (public.current_user_is_allowed() and auth.uid() = user_id)
with check (public.current_user_is_allowed() and auth.uid() = user_id);

drop policy if exists "Users delete own finance state" on public.app_states;
create policy "Users delete own finance state"
on public.app_states for delete to authenticated
using (public.current_user_is_allowed() and auth.uid() = user_id);

comment on table public.allowed_emails is
  'Server-side personal access allowlist. No frontend role has direct access.';
