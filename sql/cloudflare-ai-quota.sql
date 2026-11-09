-- Apply after page-ai-quota.sql. Both AI functions use this authenticated
-- reservation; Cloudflare Workers Free also stops requests at its own limit.
begin;
create or replace function public.reserve_page_ai_request()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  today date := (now() at time zone 'UTC')::date;
  counter public.page_ai_usage%rowtype;
  total_requests bigint;
begin
  if caller is null then raise exception 'Authentication required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(1738101642);
  select coalesce(sum(requests),0) into total_requests from public.page_ai_usage where day=today;
  if total_requests >= 100 then return jsonb_build_object('allowed',false); end if;
  insert into public.page_ai_usage(day,user_id) values(today,caller) on conflict do nothing;
  select * into counter from public.page_ai_usage where day=today and user_id=caller for update;
  if counter.requests >= 50 then return jsonb_build_object('allowed',false); end if;
  if counter.minute_started > now()-interval '1 minute' and counter.minute_requests >= 4 then
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
