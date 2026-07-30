-- JAPA FINANCE — Contrato de banco v0.2
-- Camada 1: "Para onde foi meu dinheiro?"
create extension if not exists "pgcrypto";

create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  currency char(3) not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id, name)
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id, name)
);

create table category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references categories(id),
  pattern text not null,
  kind text not null check(kind in ('exact','contains','starts_with')),
  priority int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references accounts(id),
  file_name text not null,
  file_hash text not null,
  parser_name text not null,
  parser_version text not null,
  status text not null default 'active' check(status in ('active','undone')),
  rows_read int not null default 0,
  imported int not null default 0,
  confirmed_duplicates int not null default 0,
  possible_duplicates int not null default 0,
  pending_rows int not null default 0,
  rejected int not null default 0,
  currencies text[] not null default '{}',
  first_reporting_date date,
  last_reporting_date date,
  created_at timestamptz not null default now()
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references accounts(id),
  import_id uuid references imports(id),

  bank_transaction_id text,
  dedup_fingerprint text not null,
  source_file_hash text,
  source_row_number int,

  amount_cents bigint not null check(amount_cents >= 0),
  fee_cents bigint check(fee_cents >= 0),
  balance_after_cents bigint,
  currency char(3) not null,
  direction text not null check(direction in ('inflow','outflow')),

  source text not null check(source in ('revolut_csv','manual')),
  status text not null check(status in ('completed','pending','voided','merged')),
  kind text not null check(kind in ('income','expense','transfer','refund','adjustment','unknown')),
  kind_source text not null check(kind_source in ('bank','manual','rule','unknown')),
  analysis_excluded boolean not null default false,

  description_original text not null,
  merchant_normalized text not null,
  bank_type text,
  bank_product text,
  bank_state text,

  started_at text,
  completed_at text,
  reporting_date date not null,

  category_id uuid references categories(id),
  category_source text not null check(category_source in ('manual','rule','uncategorized')),
  transfer_group_id uuid,
  merged_from_transaction_id uuid references transactions(id),
  possible_duplicate_of_id uuid references transactions(id),

  note text,
  needs_review boolean not null default false,
  review_reasons text[] not null default '{}',
  manual_edit_log jsonb not null default '[]'::jsonb,
  original_data jsonb not null default '{}'::jsonb,

  status_before_void text check(status_before_void in ('completed','pending','voided','merged')),
  void_reason text check(void_reason in ('import_undone','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index uq_transactions_bank_id
  on transactions(user_id, account_id, bank_transaction_id)
  where bank_transaction_id is not null;
create unique index uq_transactions_exact_source_row
  on transactions(user_id, account_id, source_file_hash, source_row_number)
  where source_file_hash is not null and source_row_number is not null;
create index idx_transactions_fingerprint on transactions(user_id, account_id, dedup_fingerprint);
create index idx_transactions_reporting_date on transactions(user_id, reporting_date);
create index idx_transactions_import on transactions(import_id);
create index idx_transactions_review on transactions(user_id, needs_review) where needs_review = true;
create index idx_transactions_search on transactions using gin (
  to_tsvector('simple', coalesce(description_original,'') || ' ' || coalesce(merchant_normalized,'') || ' ' || coalesce(note,''))
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_transactions_updated_at
  before update on transactions
  for each row execute function set_updated_at();

alter table accounts enable row level security;
alter table categories enable row level security;
alter table category_rules enable row level security;
alter table imports enable row level security;
alter table transactions enable row level security;

create policy accounts_owner on accounts
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy categories_owner on categories
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy category_rules_owner on category_rules
  for all using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from categories category
      where category.id = category_id and category.user_id = auth.uid()
    )
  );

create policy imports_owner on imports
  for all using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from accounts account
      where account.id = account_id and account.user_id = auth.uid()
    )
  );

create policy transactions_owner on transactions
  for all using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from accounts account
      where account.id = account_id and account.user_id = auth.uid()
    )
    and (
      category_id is null
      or exists (
        select 1 from categories category
        where category.id = category_id and category.user_id = auth.uid()
      )
    )
    and (
      import_id is null
      or exists (
        select 1 from imports import_batch
        where import_batch.id = import_id and import_batch.user_id = auth.uid()
      )
    )
  );
