-- Keep admin payment processing aligned with the verified payment provider.
-- PayPal payments are finalized only by the server-side capture verifier.
create or replace function public.verify_gamerhub_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
begin
  if not public.is_gamerhub_staff() then
    raise exception 'Staff access required.';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id and status = 'PENDING'
  for update;

  if not found then
    raise exception 'Pending payment not found.';
  end if;
  if v_payment.method = 'PayPal' then
    raise exception 'PayPal payments must be verified by PayPal server confirmation.';
  end if;

  if v_payment.reservation_id is not null then
    update public.reservations
    set status = 'CONFIRMED'
    where id = v_payment.reservation_id
      and customer_id = v_payment.customer_id
      and status = 'PENDING_PAYMENT';
    if not found then
      raise exception 'Reservation is no longer awaiting payment.';
    end if;
  elsif v_payment.session_id is not null then
    update public.sessions
    set ends_at = greatest(ends_at, now()) + make_interval(mins => coalesce(v_payment.extension_minutes, 0))
    where id = v_payment.session_id
      and customer_id = v_payment.customer_id
      and status = 'ACTIVE';
    if not found then
      raise exception 'Session is no longer active.';
    end if;
  elsif v_payment.order_id is not null then
    if not exists (
      select 1 from public.orders
      where id = v_payment.order_id
        and customer_id = v_payment.customer_id
        and status <> 'CANCELLED'
    ) then
      raise exception 'Food order is no longer available.';
    end if;
  end if;

  update public.payments set status = 'PAID' where id = v_payment.id;
end;
$$;

revoke all on function public.verify_gamerhub_payment(uuid) from public;
grant execute on function public.verify_gamerhub_payment(uuid) to authenticated;

-- Do not allow staff to cancel an order after its payment has been captured.
create or replace function public.update_gamerhub_order_status(p_order_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_paid boolean;
begin
  if not public.is_gamerhub_staff() then
    raise exception 'Staff access required.';
  end if;
  if p_status not in ('PREPARING', 'READY', 'COMPLETED', 'CANCELLED') then
    raise exception 'Unsupported order status.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  select exists (
    select 1 from public.payments
    where order_id = p_order_id and status = 'PAID'
  ) into v_paid;

  if p_status = 'CANCELLED' and v_paid then
    raise exception 'This order has a completed payment. Process a refund before cancelling it.';
  end if;
  if not (
    (v_order.status = 'PLACED' and p_status in ('PREPARING', 'CANCELLED')) or
    (v_order.status = 'PREPARING' and p_status in ('READY', 'CANCELLED')) or
    (v_order.status = 'READY' and p_status = 'COMPLETED')
  ) then
    raise exception 'This order can no longer move to that status.';
  end if;

  update public.orders set status = p_status where id = p_order_id;
  if p_status = 'CANCELLED' then
    update public.payments set status = 'FAILED'
    where order_id = p_order_id and status = 'PENDING';
  end if;
end;
$$;

revoke all on function public.update_gamerhub_order_status(uuid, text) from public;
grant execute on function public.update_gamerhub_order_status(uuid, text) to authenticated;

-- Publish session row changes so customer timers update immediately when a
-- session is activated, extended, transferred, or ended by staff.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'sessions'
    ) then
    alter publication supabase_realtime add table public.sessions;
  end if;
end;
$$;

-- A paid/confirmed reservation takes the station out of the available pool.
-- Keep this in a trigger so both counter verification and PayPal confirmation
-- update the same station row atomically.
create or replace function public.mark_gamerhub_station_reserved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'CONFIRMED' and old.status is distinct from new.status then
    update public.stations
    set status = 'RESERVED', updated_at = now()
    where id = new.station_id and status in ('AVAILABLE', 'RESERVED');
  end if;
  return new;
end;
$$;

drop trigger if exists gamerhub_mark_station_reserved on public.reservations;
create trigger gamerhub_mark_station_reserved
after update of status on public.reservations
for each row
when (new.status = 'CONFIRMED' and old.status is distinct from new.status)
execute function public.mark_gamerhub_station_reserved();

-- Bring any already-paid reservations into line when this migration is applied.
update public.stations s
set status = 'RESERVED', updated_at = now()
where s.status = 'AVAILABLE'
  and exists (
    select 1 from public.reservations r
    where r.station_id = s.id and r.status = 'CONFIRMED' and r.ends_at > now()
  );

-- Reserved stations may still take a different, non-overlapping time slot.
create or replace function public.create_gamerhub_reservation(
  p_station_id text,
  p_package_id text,
  p_start_at timestamptz default now()
)
returns public.reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.reservations;
  v_minutes integer;
  v_price numeric;
  v_pin text;
  v_station_status text;
begin
  if auth.uid() is null then raise exception 'Sign in to reserve a station.'; end if;
  if p_start_at is null then raise exception 'Choose a booking date and time.'; end if;
  if p_start_at < now() - interval '1 minute' then raise exception 'The selected booking date and time have already passed.'; end if;

  select duration_minutes, price into v_minutes, v_price
  from public.playtime_packages where id = p_package_id and is_active;
  if v_minutes is null then raise exception 'This playtime package is unavailable.'; end if;

  select status into v_station_status from public.stations where id = p_station_id for update;
  if not found then raise exception 'This station no longer exists. Refresh the station list and try again.'; end if;
  if v_station_status = 'MAINTENANCE' then raise exception 'This station is under maintenance. Choose another station.'; end if;
  if p_start_at <= now() + interval '5 minutes' and v_station_status not in ('AVAILABLE', 'RESERVED') then
    raise exception 'This station is currently in use. Choose a future time or another station.';
  end if;

  if exists (
    select 1 from public.reservations r
    where r.station_id = p_station_id
      and r.status in ('PENDING_PAYMENT', 'CONFIRMED', 'ACTIVE')
      and (r.status <> 'PENDING_PAYMENT' or r.created_at > now() - interval '15 minutes')
      and tstzrange(r.start_at, r.ends_at, '[)')
        && tstzrange(p_start_at, p_start_at + make_interval(mins => v_minutes), '[)')
  ) then raise exception 'This date and time is already booked. Choose another time or station.'; end if;

  loop
    v_pin := lpad(floor(random() * 1000000)::int::text, 6, '0');
    exit when not exists (select 1 from public.reservations where activation_pin = v_pin);
  end loop;

  insert into public.reservations (customer_id, station_id, package_id, start_at, ends_at, total_amount, activation_pin)
  values (auth.uid(), p_station_id, p_package_id, p_start_at,
    p_start_at + make_interval(mins => v_minutes), v_price, v_pin)
  returning * into v_res;
  return v_res;
end;
$$;
revoke all on function public.create_gamerhub_reservation(text, text, timestamptz) from public;
grant execute on function public.create_gamerhub_reservation(text, text, timestamptz) to authenticated;

-- A confirmed reservation can be activated whether its station is RESERVED
-- or still AVAILABLE (for a scheduled reservation on a busy station).
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
  if not public.is_gamerhub_staff() then raise exception 'Staff access required.'; end if;
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found or v_res.status <> 'CONFIRMED' then raise exception 'Only confirmed reservations can be activated.'; end if;
  if p_pin is null or p_pin !~ '^\d{6}$' or v_res.activation_pin is distinct from p_pin then raise exception 'The reservation PIN does not match.'; end if;
  if v_res.start_at > now() + interval '5 minutes' then raise exception 'This reservation has not reached its scheduled start time yet.'; end if;
  if v_res.ends_at <= now() then raise exception 'This reservation time has ended. Ask the customer to book another time.'; end if;

  update public.stations set status = 'OCCUPIED', updated_at = now()
  where id = v_res.station_id and status in ('AVAILABLE', 'RESERVED');
  if not found then raise exception 'Station is not available to activate right now.'; end if;

  insert into public.sessions (reservation_id, customer_id, station_id, ends_at)
  values (v_res.id, v_res.customer_id, v_res.station_id, v_res.ends_at)
  returning * into v_session;
  update public.reservations set status = 'ACTIVE' where id = v_res.id;
  return v_session;
end;
$$;
revoke all on function public.activate_gamerhub_reservation_with_pin(uuid, text) from public;
grant execute on function public.activate_gamerhub_reservation_with_pin(uuid, text) to authenticated;

-- After a session, leave a station RESERVED if another paid booking is queued.
create or replace function public.end_gamerhub_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_station text;
  v_reservation uuid;
begin
  if not public.is_gamerhub_staff() then raise exception 'Staff access required.'; end if;
  update public.sessions set status = 'COMPLETED', ended_at = now()
  where id = p_session_id and status = 'ACTIVE'
  returning station_id, reservation_id into v_station, v_reservation;
  if v_station is null then raise exception 'Active session not found.'; end if;

  update public.reservations set status = 'COMPLETED' where id = v_reservation;
  update public.stations set status = case
    when exists (
      select 1 from public.reservations
      where station_id = v_station and status = 'CONFIRMED' and ends_at > now()
    ) then 'RESERVED'
    else 'AVAILABLE'
  end, updated_at = now()
  where id = v_station and status in ('OCCUPIED', 'RESERVED');
end;
$$;
revoke all on function public.end_gamerhub_session(uuid) from public;
grant execute on function public.end_gamerhub_session(uuid) to authenticated;

notify pgrst, 'reload schema';
