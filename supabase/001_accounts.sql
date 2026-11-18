-- Fieldwork phase 1: student accounts and synced workspace.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to re-run: it only creates things that don't exist yet.
--
-- Security model: every row belongs to one auth user, and row-level security
-- only lets a signed-in student read or change their own rows. The browser uses
-- the public publishable key; nothing here needs the secret key.

-- Profile -------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text check (char_length(name) <= 60),
  major text check (char_length(major) <= 100),
  level text check (char_length(level) <= 40),
  city text check (char_length(city) <= 80),
  state text check (char_length(state) <= 40),
  radius_miles integer check (radius_miles between 0 and 500),
  interests text check (char_length(interests) <= 400),
  available date,
  work text check (char_length(work) <= 40),
  updated_at timestamptz not null default now()
);

-- Saved opportunities (bookmarks) --------------------------------------------
create table if not exists public.saved_opportunities (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 200),
  url text not null check (char_length(url) <= 2000 and url ~ '^https?://'),
  title text not null check (char_length(title) between 1 and 300),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 20000),
  saved_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Application tracker ---------------------------------------------------------
create table if not exists public.applications (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 200),
  title text not null check (char_length(title) between 1 and 300),
  url text check (url is null or (char_length(url) <= 2000 and url ~ '^https?://')),
  status text not null default 'Saved'
    check (status in ('Saved', 'Preparing', 'Applied', 'Interview', 'Offer', 'Closed')),
  deadline date,
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Row-level security ----------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.saved_opportunities enable row level security;
alter table public.applications enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "own saved" on public.saved_opportunities;
create policy "own saved" on public.saved_opportunities
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own applications" on public.applications;
create policy "own applications" on public.applications
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Anonymous visitors get no table access at all.
revoke all on public.profiles, public.saved_opportunities, public.applications from anon;
grant select, insert, update, delete
  on public.profiles, public.saved_opportunities, public.applications to authenticated;

-- Per-student row caps (abuse protection) -------------------------------------
create or replace function public.enforce_row_cap()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cap integer := tg_argv[0]::integer;
  existing integer;
begin
  execute format('select count(*) from %I.%I where user_id = $1', tg_table_schema, tg_table_name)
    into existing using new.user_id;
  if existing >= cap then
    raise exception 'Limit of % items reached', cap using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists saved_cap on public.saved_opportunities;
create trigger saved_cap before insert on public.saved_opportunities
  for each row execute function public.enforce_row_cap('200');

drop trigger if exists applications_cap on public.applications;
create trigger applications_cap before insert on public.applications
  for each row execute function public.enforce_row_cap('200');

-- Keep updated_at honest -------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists applications_touch on public.applications;
create trigger applications_touch before update on public.applications
  for each row execute function public.touch_updated_at();
