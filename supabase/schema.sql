create table if not exists public.transactions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  type text not null check (type in ('income', 'expense')),
  amount_minor bigint not null check (amount_minor > 0),
  date date not null,
  category_id text not null,
  account_id text not null,
  note text not null default '',
  recurring_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.categories (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  icon text not null,
  color text not null,
  type text not null check (type in ('income', 'expense', 'both')),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.budgets (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  category_id text not null,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  limit_minor bigint not null check (limit_minor > 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.accounts (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  kind text not null check (kind in ('cash', 'bank', 'card')),
  opening_balance_minor bigint not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.goals (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  target_minor bigint not null check (target_minor > 0),
  target_date date,
  saved_minor bigint not null default 0 check (saved_minor >= 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.recurring (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  type text not null check (type in ('income', 'expense')),
  amount_minor bigint not null check (amount_minor > 0),
  category_id text not null,
  account_id text not null,
  frequency text not null check (frequency in ('weekly', 'monthly', 'yearly')),
  next_due date not null,
  day_of_month integer not null check (day_of_month between 1 and 31),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  theme text check (theme in ('light', 'dark')),
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles alter column theme drop not null;
alter table public.profiles alter column theme drop default;

do $$
declare
  table_name text;
begin
  grant usage on schema public to authenticated;
  foreach table_name in array array['transactions', 'categories', 'budgets', 'accounts', 'goals', 'recurring']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'drop policy if exists %I on public.%I',
      'Users manage their own ' || table_name, table_name
    );
    execute format(
      'create policy %I on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      'Users manage their own ' || table_name, table_name
    );
    execute format('revoke all on public.%I from anon', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
  end loop;
end
$$;

create or replace function public.create_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), ''), 80)
  )
  on conflict (user_id) do nothing;
  return new;
end
$$;

revoke all on function public.create_user_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_user_profile();

insert into public.profiles (user_id, display_name)
select id, left(coalesce(nullif(btrim(raw_user_meta_data ->> 'display_name'), ''), ''), 80)
from auth.users
on conflict (user_id) do nothing;

alter table public.profiles enable row level security;
drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile"
  on public.profiles for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, theme) on public.profiles to authenticated;
