-- Derive station status from the same reservations and sessions used by both
-- customer and admin screens. This repairs status drift and prevents a paid
-- reservation from still appearing Available to another gamer.

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
        and (
          r.status in ('CONFIRMED', 'ACTIVE')
          or (r.status = 'PENDING_PAYMENT' and r.created_at > now() - interval '15 minutes')
        )
    ) then 'RESERVED'
    else 'AVAILABLE'
  end,
  updated_at = now()
  where s.id = p_station_id;
end;
$$;

create or replace function public.sync_gamerhub_station_after_reservation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_gamerhub_station_status(old.station_id);
    return old;
  end if;
  perform public.sync_gamerhub_station_status(new.station_id);
  if tg_op = 'UPDATE' and old.station_id is distinct from new.station_id then
    perform public.sync_gamerhub_station_status(old.station_id);
  end if;
  return new;
end;
$$;

drop trigger if exists gamerhub_sync_station_reservation on public.reservations;
create trigger gamerhub_sync_station_reservation
  after insert or update or delete on public.reservations
  for each row execute function public.sync_gamerhub_station_after_reservation_change();

create or replace function public.sync_gamerhub_station_after_session_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_gamerhub_station_status(old.station_id);
    return old;
  end if;
  perform public.sync_gamerhub_station_status(new.station_id);
  if tg_op = 'UPDATE' and old.station_id is distinct from new.station_id then
    perform public.sync_gamerhub_station_status(old.station_id);
  end if;
  return new;
end;
$$;

drop trigger if exists gamerhub_sync_station_session on public.sessions;
create trigger gamerhub_sync_station_session
  after insert or update or delete on public.sessions
  for each row execute function public.sync_gamerhub_station_after_session_change();

-- Backfill every existing station from its live reservation/session state.
do $$
declare
  v_station_id text;
begin
  for v_station_id in select id from public.stations loop
    perform public.sync_gamerhub_station_status(v_station_id);
  end loop;
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
          and (
            r.status in ('CONFIRMED', 'ACTIVE')
            or (r.status = 'PENDING_PAYMENT' and r.created_at > now() - interval '15 minutes')
          )
      ) then 'RESERVED'
      else 'AVAILABLE'
    end as status,
    s.created_at, s.updated_at
  from public.stations s
  where auth.uid() is not null
  order by s.name;
$$;

revoke all on function public.sync_gamerhub_station_status(text) from public;
revoke all on function public.get_gamerhub_station_availability() from public;
grant execute on function public.get_gamerhub_station_availability() to authenticated;

notify pgrst, 'reload schema';
