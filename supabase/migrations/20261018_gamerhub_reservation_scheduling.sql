-- Make the selected booking date/time authoritative and allow future bookings
-- on stations that are occupied now, while rejecting maintenance and overlaps.
create or replace function public.create_gamerhub_reservation(
  p_station_id text,
  p_package_id text,
  p_start_at timestamptz default now()
)
returns public.reservations
language plpgsql security definer set search_path = public
as $$
declare
  v_res public.reservations;
  v_minutes integer;
  v_price numeric;
  v_pin text;
  v_station_status text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to reserve a station.';
  end if;
  if p_start_at is null then
    raise exception 'Choose a booking date and time.';
  end if;
  if p_start_at < now() - interval '1 minute' then
    raise exception 'The selected booking date and time have already passed.';
  end if;

  select duration_minutes, price into v_minutes, v_price
    from public.playtime_packages where id = p_package_id and is_active;
  if v_minutes is null then
    raise exception 'This playtime package is unavailable.';
  end if;

  select status into v_station_status from public.stations
    where id = p_station_id for update;
  if not found then
    raise exception 'This station no longer exists. Refresh the station list and try again.';
  end if;
  if v_station_status = 'MAINTENANCE' then
    raise exception 'This station is under maintenance. Choose another station.';
  end if;
  if p_start_at <= now() + interval '5 minutes' and v_station_status <> 'AVAILABLE' then
    raise exception 'This station is currently in use. Choose a future time or another station.';
  end if;

  if exists (
    select 1 from public.reservations r
    where r.station_id = p_station_id
      and r.status in ('PENDING_PAYMENT', 'CONFIRMED', 'ACTIVE')
      and (r.status <> 'PENDING_PAYMENT' or r.created_at > now() - interval '15 minutes')
      and tstzrange(r.start_at, r.ends_at, '[)')
        && tstzrange(p_start_at, p_start_at + make_interval(mins => v_minutes), '[)')
  ) then
    raise exception 'This date and time is already booked. Choose another time or station.';
  end if;

  loop
    v_pin := lpad(floor(random() * 1000000)::int::text, 6, '0');
    exit when not exists (select 1 from public.reservations where activation_pin = v_pin);
  end loop;

  insert into public.reservations (
    customer_id, station_id, package_id, start_at, ends_at, total_amount, activation_pin
  ) values (
    auth.uid(), p_station_id, p_package_id, p_start_at,
    p_start_at + make_interval(mins => v_minutes), v_price, v_pin
  ) returning * into v_res;
  return v_res;
end;
$$;
revoke all on function public.create_gamerhub_reservation(text, text, timestamptz) from public;
grant execute on function public.create_gamerhub_reservation(text, text, timestamptz) to authenticated;

-- Staff activation is allowed when the scheduled booking window has begun.
create or replace function public.activate_gamerhub_reservation(p_reservation_id uuid)
returns public.sessions language plpgsql security definer set search_path = public
as $$
declare
  v_res public.reservations;
  v_session public.sessions;
begin
  if not public.is_gamerhub_staff() then
    raise exception 'Staff access required.';
  end if;
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found or v_res.status <> 'CONFIRMED' then
    raise exception 'Only confirmed reservations can be activated.';
  end if;
  if v_res.start_at > now() + interval '5 minutes' then
    raise exception 'This reservation has not reached its scheduled start time yet.';
  end if;
  if v_res.ends_at <= now() then
    raise exception 'This reservation time has ended. Ask the customer to book another time.';
  end if;
  update public.stations set status = 'OCCUPIED', updated_at = now()
    where id = v_res.station_id and status = 'AVAILABLE';
  if not found then
    raise exception 'Station is not available to activate right now.';
  end if;
  insert into public.sessions (reservation_id, customer_id, station_id, ends_at)
  values (v_res.id, v_res.customer_id, v_res.station_id, v_res.ends_at)
  returning * into v_session;
  update public.reservations set status = 'ACTIVE' where id = v_res.id;
  return v_session;
end;
$$;
revoke all on function public.activate_gamerhub_reservation(uuid) from public;
grant execute on function public.activate_gamerhub_reservation(uuid) to authenticated;
