-- Fieldwork: monthly limits for the AI Studio tools.
-- Run after 002_billing.sql (SQL Editor → New query → paste → Run). Safe to re-run.
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
  cap := case p_action
    when 'briefing' then 30
    when 'email' then 60
    when 'review' then 15
    when 'application' then 15
    when 'interview' then 10
    when 'chat' then 150
    when 'import' then 10
    when 'letter' then 10
    else 0 end;
  if cap = 0 then
    return query select false, 0;
    return;
  end if;
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
