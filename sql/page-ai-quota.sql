-- Additive migration. No prompts, page contents, keys or model output stored.
begin;
create table if not exists public.page_ai_usage (
  day date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  requests integer not null default 0,
  minute_started timestamptz not null default now(),
  minute_requests integer not null default 0,
  primary key (day,user_id)
);
alter table public.page_ai_usage enable row level security;
revoke all on public.page_ai_usage from public, anon, authenticated;

create or replace function public.reserve_page_ai_request()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  today date := (now() at time zone 'UTC')::date;
  counter public.page_ai_usage%rowtype;
  total_requests bigint;
begin
  if caller is null then raise exception 'Authentication required'; end if;
  -- Serialize reservations across function instances; in-memory limits alone
  -- are not reliable in an autoscaling runtime. Limits count failed attempts.
  perform pg_catalog.pg_advisory_xact_lock(1738101642);
  select coalesce(sum(requests),0) into total_requests from public.page_ai_usage where day=today;
  if total_requests >= 20 then return jsonb_build_object('allowed',false); end if;
  insert into public.page_ai_usage(day,user_id) values(today,caller) on conflict do nothing;
  select * into counter from public.page_ai_usage where day=today and user_id=caller for update;
  if counter.requests >= 10 then return jsonb_build_object('allowed',false); end if;
  if counter.minute_started > now()-interval '1 minute' and counter.minute_requests >= 2 then
    return jsonb_build_object('allowed',false);
  end if;
  update public.page_ai_usage set requests=requests+1,
    minute_requests=case when minute_started <= now()-interval '1 minute' then 1 else minute_requests+1 end,
    minute_started=case when minute_started <= now()-interval '1 minute' then now() else minute_started end
    where day=today and user_id=caller;
  return jsonb_build_object('allowed',true);
end;
$$;
revoke all on function public.reserve_page_ai_request() from public, anon;
grant execute on function public.reserve_page_ai_request() to authenticated;
commit;
