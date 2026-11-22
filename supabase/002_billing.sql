-- Fieldwork: Pro subscriptions (Paddle) and AI usage limits.
-- Run after 001_accounts.sql: Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run.

-- Subscriptions are written only by the server's Paddle webhook (secret key),
-- and each student can read their own.
create table if not exists public.subscriptions (
  paddle_subscription_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  paddle_customer_id text,
  plan text not null default 'pro',
  price_id text,
  status text not null,
  current_period_end timestamptz,
  updated_at timestamptz not null default now(),
  event_time timestamptz
);
create index if not exists subscriptions_user on public.subscriptions (user_id);

alter table public.subscriptions enable row level security;
drop policy if exists "read own subscription" on public.subscriptions;
create policy "read own subscription" on public.subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

-- Monthly AI usage. Students can read their counts but never write them;
-- only consume_ai_quota() below changes them.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  month text not null,
  action text not null,
  count integer not null default 0,
  primary key (user_id, month, action)
);
alter table public.ai_usage enable row level security;
drop policy if exists "read own usage" on public.ai_usage;
create policy "read own usage" on public.ai_usage
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;

-- Reserve one use of an AI action for the calling student, if their plan allows it.
-- Limits match LIMITS.pro in lib/pro.mjs.
create or replace function public.consume_ai_quota(p_action text)
returns table (allowed boolean, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cap integer;
  m text := to_char(now() at time zone 'utc', 'YYYY-MM');
  used integer;
begin
  if uid is null then
    return query select false, 0;
    return;
  end if;
  if not exists (
    select 1 from public.subscriptions s
    where s.user_id = uid
      and s.status in ('active', 'trialing', 'past_due')
      and (s.current_period_end is null or s.current_period_end > now())
  ) then
    return query select false, 0;
    return;
  end if;
  cap := case p_action when 'briefing' then 30 when 'email' then 60 else 0 end;
  insert into public.ai_usage (user_id, month, action, count)
    values (uid, m, p_action, 0)
    on conflict (user_id, month, action) do nothing;
  select u.count into used from public.ai_usage u
    where u.user_id = uid and u.month = m and u.action = p_action
    for update;
  if used >= cap then
    return query select false, 0;
    return;
  end if;
  update public.ai_usage set count = count + 1
    where user_id = uid and month = m and action = p_action;
  return query select true, cap - used - 1;
end;
$$;
revoke all on function public.consume_ai_quota(text) from public, anon;
grant execute on function public.consume_ai_quota(text) to authenticated;

-- School and résumé-free profile extras for better drafts.
alter table public.profiles add column if not exists school text check (char_length(school) <= 100);
