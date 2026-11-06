-- Keep maintenance record and station availability changes in one transaction.
create or replace function public.manage_gamerhub_maintenance(
  p_station_id text,
  p_action text,
  p_issue text default null,
  p_record_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_station public.stations;
  v_record public.maintenance_records;
begin
  if not public.is_gamerhub_staff() then
    raise exception 'Staff access required.';
  end if;

  if p_action = 'REPORT' then
    select * into v_station from public.stations where id = p_station_id for update;
    if not found then raise exception 'Station not found.'; end if;
    if v_station.status not in ('AVAILABLE', 'MAINTENANCE') then
      raise exception 'Only an available or already-maintained station can receive a maintenance report.';
    end if;
    if nullif(trim(p_issue), '') is null then raise exception 'Describe the maintenance issue first.'; end if;

    insert into public.maintenance_records (station_id, reported_by, issue)
    values (p_station_id, auth.uid(), trim(p_issue));
    update public.stations set status = 'MAINTENANCE', updated_at = now() where id = p_station_id;
  elsif p_action = 'START' then
    update public.maintenance_records
      set status = 'IN_PROGRESS'
      where id = p_record_id and station_id = p_station_id and status = 'OPEN';
    if not found then raise exception 'Open maintenance report not found.'; end if;
  elsif p_action = 'RESOLVE' then
    select * into v_record from public.maintenance_records
      where id = p_record_id and station_id = p_station_id and status in ('OPEN', 'IN_PROGRESS') for update;
    if not found then raise exception 'Open maintenance report not found.'; end if;

    update public.maintenance_records
      set status = 'RESOLVED', resolved_at = now()
      where id = v_record.id;

    if not exists (
      select 1 from public.maintenance_records
      where station_id = p_station_id and status <> 'RESOLVED'
    ) then
      update public.stations
        set status = 'AVAILABLE', updated_at = now()
        where id = p_station_id and status = 'MAINTENANCE';
    end if;
  else
    raise exception 'Unsupported maintenance action.';
  end if;
end;
$$;
revoke all on function public.manage_gamerhub_maintenance(text, text, text, uuid) from public;
grant execute on function public.manage_gamerhub_maintenance(text, text, text, uuid) to authenticated;

-- Return full-history report aggregates without exposing other customers' rows
-- to the mobile client. The chart buckets use the database's local timezone.
create or replace function public.get_gamerhub_admin_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_report jsonb;
begin
  if not public.is_gamerhub_staff() then
    raise exception 'Staff access required.';
  end if;

  select jsonb_build_object(
    'verified_revenue', coalesce((select sum(amount) from public.payments where status = 'PAID'), 0),
    'paid_transactions', (select count(*) from public.payments where status = 'PAID'),
    'sessions_total', (select count(*) from public.sessions),
    'completed_orders', (select count(*) from public.orders where status = 'COMPLETED'),
    'orders_today', (select count(*) from public.orders where created_at >= date_trunc('day', now())),
    'peak_hours', coalesce((
      select jsonb_agg(jsonb_build_object('hour', hour, 'count', session_count) order by hour)
      from (
        select extract(hour from started_at)::integer as hour, count(*)::integer as session_count
        from public.sessions
        group by extract(hour from started_at)::integer
      ) as usage_by_hour
    ), '[]'::jsonb)
  ) into v_report;

  return v_report;
end;
$$;
revoke all on function public.get_gamerhub_admin_report() from public;
grant execute on function public.get_gamerhub_admin_report() to authenticated;

notify pgrst, 'reload schema';
