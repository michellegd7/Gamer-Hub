-- Preserve admin-set Reserved stations and publish status changes to gamer apps.
alter table public.stations
  add column if not exists admin_reserved boolean not null default false;

create or replace function public.set_gamerhub_station_status(
  p_station_id text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_station public.stations;
begin
  if not public.is_gamerhub_staff() then
    raise exception 'Staff access required.';
  end if;

  if p_status not in ('AVAILABLE', 'RESERVED') then
    raise exception 'Choose Available or Reserved. Record maintenance through the Maintenance section.';
  end if;

  select * into v_station
  from public.stations
  where id = p_station_id
  for update;
  if not found then raise exception 'Station not found.'; end if;

  if exists (
    select 1 from public.sessions
    where station_id = p_station_id and status = 'ACTIVE' and ends_at > now()
  ) then
    raise exception 'This station has an active session. End it before changing its status.';
  end if;

  if exists (
    select 1 from public.reservations
    where station_id = p_station_id and ends_at > now()
      and (status in ('CONFIRMED', 'ACTIVE')
        or (status = 'PENDING_PAYMENT' and created_at > now() - interval '15 minutes'))
  ) then
    raise exception 'This station has a customer reservation. Resolve it before changing its status.';
  end if;

  if exists (
    select 1 from public.maintenance_records
    where station_id = p_station_id and status <> 'RESOLVED'
  ) then
    raise exception 'Resolve the open maintenance report before changing this station status.';
  end if;

  update public.stations
  set status = p_status,
      admin_reserved = (p_status = 'RESERVED'),
      updated_at = now()
  where id = p_station_id;
end;
$$;

revoke all on function public.set_gamerhub_station_status(text, text) from public;
grant execute on function public.set_gamerhub_station_status(text, text) to authenticated;

create or replace function public.sync_gamerhub_station_status(p_station_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.stations s
  set status = case
    when s.status = 'MAINTENANCE' then 'MAINTENANCE'
    when exists (
      select 1 from public.sessions se
      where se.station_id = s.id and se.status = 'ACTIVE' and se.ends_at > now()
    ) then 'OCCUPIED'
    when exists (
      select 1 from public.reservations r
      where r.station_id = s.id and r.ends_at > now()
        and (r.status in ('CONFIRMED', 'ACTIVE')
          or (r.status = 'PENDING_PAYMENT' and r.created_at > now() - interval '15 minutes'))
    ) then 'RESERVED'
    when s.admin_reserved then 'RESERVED'
    else 'AVAILABLE'
  end,
  updated_at = now()
  where s.id = p_station_id;
end;
$$;

create or replace function public.get_gamerhub_station_availability()
returns table (
  id text,
  name text,
  station_type text,
  gpu text,
  processor text,
  ram text,
  monitor text,
  hourly_rate numeric,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.name, s.station_type, s.gpu, s.processor, s.ram, s.monitor,
    s.hourly_rate,
    case
      when s.status = 'MAINTENANCE' then 'MAINTENANCE'
      when exists (
        select 1 from public.sessions se
        where se.station_id = s.id and se.status = 'ACTIVE' and se.ends_at > now()
      ) then 'OCCUPIED'
      when exists (
        select 1 from public.reservations r
        where r.station_id = s.id and r.ends_at > now()
          and (r.status in ('CONFIRMED', 'ACTIVE')
            or (r.status = 'PENDING_PAYMENT' and r.created_at > now() - interval '15 minutes'))
      ) then 'RESERVED'
      when s.admin_reserved then 'RESERVED'
      else 'AVAILABLE'
    end as status,
    s.created_at, s.updated_at
  from public.stations s
  where auth.uid() is not null
  order by s.name;
$$;

revoke all on function public.get_gamerhub_station_availability() from public;
grant execute on function public.get_gamerhub_station_availability() to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stations'
     ) then
    execute 'alter publication supabase_realtime add table public.stations';
  end if;
end;
$$;

notify pgrst, 'reload schema';
