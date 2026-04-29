create extension if not exists "pgcrypto";

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  balance numeric not null default 0,
  color text,
  created_at timestamptz not null default now()
);

create table if not exists public.budget_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  limit_amount numeric not null default 0,
  spent_amount numeric not null default 0,
  color text,
  created_at timestamptz not null default now()
);

create table if not exists public.budget_periods (
  user_id uuid primary key references auth.users(id) on delete cascade,
  label text not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  role text not null default 'Member',
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  amount numeric not null,
  type text not null check (type in ('expense', 'income', 'transfer')),
  category text not null,
  account_name text not null,
  note text,
  date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.accounts enable row level security;
alter table public.budget_categories enable row level security;
alter table public.budget_periods enable row level security;
alter table public.members enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "accounts owner access" on public.accounts;
drop policy if exists "budget categories owner access" on public.budget_categories;
drop policy if exists "budget periods owner access" on public.budget_periods;
drop policy if exists "members owner access" on public.members;
drop policy if exists "members can read own email" on public.members;
drop policy if exists "transactions owner access" on public.transactions;

create policy "accounts owner access" on public.accounts
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "budget categories owner access" on public.budget_categories
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "budget periods owner access" on public.budget_periods
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "members owner access" on public.members
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "members can read own email" on public.members
for select using (lower(email) = lower(auth.jwt() ->> 'email'));

create policy "transactions owner access" on public.transactions
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
