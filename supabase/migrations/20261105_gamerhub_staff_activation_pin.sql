-- Require the reservation's six-digit PIN for staff session activation.
-- Disable the previous PIN-less RPC so it cannot bypass this check.
revoke all on function public.activate_gamerhub_reservation(uuid) from public, anon, authenticated;

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
  if v_res.ends_at <= now() then
    raise exception 'This reservation time has ended. Ask the customer to book another time.';
  end if;

  update public.stations
  set status = 'OCCUPIED', updated_at = now()
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

revoke all on function public.activate_gamerhub_reservation_with_pin(uuid, text) from public;
grant execute on function public.activate_gamerhub_reservation_with_pin(uuid, text) to authenticated;
