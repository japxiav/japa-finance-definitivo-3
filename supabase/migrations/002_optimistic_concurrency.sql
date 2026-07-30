-- Japa Finance v0.4
-- Evita sobrescrita silenciosa entre aparelhos com compare-and-swap por revisão.

alter table public.app_states
  add column if not exists revision bigint;

update public.app_states
set revision = 1
where revision is null;

alter table public.app_states
  alter column revision set default 1,
  alter column revision set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_states_revision_positive'
      and conrelid = 'public.app_states'::regclass
  ) then
    alter table public.app_states
      add constraint app_states_revision_positive check (revision > 0);
  end if;
end;
$$;

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
