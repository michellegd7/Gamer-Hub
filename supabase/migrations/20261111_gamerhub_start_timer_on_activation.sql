-- Start the paid playtime clock when staff activates the customer PIN.
-- A delayed payment/activation must not consume the customer's purchased time.
create or replace function public.activate_gamerhub_reservation_with_pin(
  p_reservation_id uuid,
  p_pin text
)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.reservations;
  v_session public.sessions;
  v_station_status text;
  v_started_at timestamptz := now();
  v_duration interval;
  v_ends_at timestamptz;
begin
  if not public.is_gamerhub_staff() then
    raise exception 'Staff access required.';
  end if;

  select * into v_res
  from public.reservations
  where id = p_reservation_id
  for update;

  if not found or v_res.status <> 'CONFIRMED' then
    raise exception 'Only confirmed reservations can be activated.';
  end if;
  if p_pin is null or p_pin !~ '^\d{6}$' or v_res.activation_pin is distinct from p_pin then
    raise exception 'The reservation PIN does not match.';
  end if;
  if v_res.start_at > now() + interval '5 minutes' then
    raise exception 'This reservation has not reached its scheduled start time yet.';
  end if;

  v_duration := v_res.ends_at - v_res.start_at;
  if v_duration <= interval '0 seconds' then
    raise exception 'This reservation has no valid playtime duration. Contact an administrator.';
  end if;
  v_ends_at := v_started_at + v_duration;

  -- Serialize activation with booking creation, then protect the next paid
  -- reservation from being overlapped by a delayed session start.
  select status into v_station_status
  from public.stations
  where id = v_res.station_id
  for update;

  if not found or v_station_status not in ('AVAILABLE', 'RESERVED') then
    raise exception 'Station is not available to activate right now.';
  end if;
  if exists (
    select 1
    from public.reservations r
    where r.station_id = v_res.station_id
      and r.id <> v_res.id
      and r.status in ('PENDING_PAYMENT', 'CONFIRMED', 'ACTIVE')
      and (r.status <> 'PENDING_PAYMENT' or r.created_at > now() - interval '15 minutes')
      and tstzrange(r.start_at, r.ends_at, '[)')
        && tstzrange(v_started_at, v_ends_at, '[)')
  ) then
    raise exception 'Starting now would overlap another station booking. Choose another available station or contact the customer before activation.';
  end if;

  update public.stations
  set status = 'OCCUPIED', updated_at = now()
  where id = v_res.station_id
    and status in ('AVAILABLE', 'RESERVED');
  if not found then
    raise exception 'Station is not available to activate right now.';
  end if;

  insert into public.sessions (reservation_id, customer_id, station_id, started_at, ends_at)
  values (v_res.id, v_res.customer_id, v_res.station_id, v_started_at, v_ends_at)
  returning * into v_session;

  update public.reservations
  set status = 'ACTIVE', start_at = v_started_at, ends_at = v_ends_at
  where id = v_res.id;

  return v_session;
end;
$$;

revoke all on function public.activate_gamerhub_reservation_with_pin(uuid, text) from public;
grant execute on function public.activate_gamerhub_reservation_with_pin(uuid, text) to authenticated;

notify pgrst, 'reload schema';
