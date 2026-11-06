-- Notify customers as the reservation/session/order actually advances.
-- The earlier insert trigger announced a PIN before payment was confirmed.
drop trigger if exists reservation_created_notification on public.reservations;

create or replace function public.notify_gamerhub_reservation_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_station_name text;
  v_title text;
  v_message text;
begin
  if new.status is not distinct from old.status then return new; end if;

  select name into v_station_name from public.stations where id = new.station_id;
  if old.status = 'PENDING_PAYMENT' and new.status = 'CONFIRMED' then
    v_title := 'Reservation confirmed · PIN ready';
    v_message := coalesce(v_station_name, new.station_id) || ' is confirmed. Open Your Activity → Sessions to view your six-digit activation PIN, then show it to staff when you arrive.';
  elsif new.status = 'ACTIVE' then
    v_title := 'Your gaming session has started';
    v_message := 'Your session at ' || coalesce(v_station_name, new.station_id) || ' is active. Your live remaining time is available on Home under Session Timer.';
  elsif new.status = 'COMPLETED' then
    v_title := 'Session completed';
    v_message := 'Your session at ' || coalesce(v_station_name, new.station_id) || ' has ended. You can review it in Your Activity.';
  else
    return new;
  end if;

  insert into public.user_notifications(user_id, reservation_id, title, message)
  values (new.customer_id, new.id, v_title, v_message);
  return new;
end;
$$;

drop trigger if exists gamerhub_reservation_status_notification on public.reservations;
create trigger gamerhub_reservation_status_notification
  after update of status on public.reservations
  for each row execute function public.notify_gamerhub_reservation_status();

create or replace function public.notify_gamerhub_payment_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_station_name text;
  v_minutes integer;
  v_message text;
begin
  if new.status <> 'PAID' or old.status = 'PAID' then return new; end if;

  if new.session_id is not null and coalesce(new.extension_minutes, 0) > 0 then
    select st.name into v_station_name
      from public.sessions s join public.stations st on st.id = s.station_id
      where s.id = new.session_id;
    v_minutes := new.extension_minutes;
    v_message := 'Your ' || v_minutes || '-minute playtime extension was paid' ||
      case when v_station_name is not null then ' for ' || v_station_name else '' end ||
      '. Your session timer will show the updated remaining time.';
    insert into public.user_notifications(user_id, title, message)
    values (new.customer_id, 'Playtime extension payment confirmed', v_message);
  elsif new.order_id is not null then
    insert into public.user_notifications(user_id, title, message)
    values (new.customer_id, 'Food order payment confirmed', 'Payment for your food and drinks order was received. Follow preparation and pickup updates in Orders.');
  end if;
  return new;
end;
$$;

drop trigger if exists gamerhub_payment_status_notification on public.payments;
create trigger gamerhub_payment_status_notification
  after update of status on public.payments
  for each row execute function public.notify_gamerhub_payment_status();

create or replace function public.notify_gamerhub_transfer_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_name text;
  v_to_name text;
  v_message text;
begin
  if new.status is not distinct from old.status or new.status not in ('APPROVED', 'DECLINED') then return new; end if;
  select name into v_from_name from public.stations where id = new.from_station_id;
  select name into v_to_name from public.stations where id = new.to_station_id;
  v_message := case when new.status = 'APPROVED'
    then 'Your transfer from ' || coalesce(v_from_name, new.from_station_id) || ' to ' || coalesce(v_to_name, new.to_station_id) || ' was approved.'
    else 'Your station transfer request was declined. Your current session is unchanged.'
  end;
  insert into public.user_notifications(user_id, title, message)
  values (new.customer_id, case when new.status = 'APPROVED' then 'Station transfer approved' else 'Station transfer update' end, v_message);
  return new;
end;
$$;

drop trigger if exists gamerhub_transfer_status_notification on public.transfer_requests;
create trigger gamerhub_transfer_status_notification
  after update of status on public.transfer_requests
  for each row execute function public.notify_gamerhub_transfer_status();

create or replace function public.notify_gamerhub_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_message text;
begin
  if new.status is not distinct from old.status then return new; end if;
  v_title := case new.status
    when 'PREPARING' then 'Your order is being prepared'
    when 'READY' then 'Your order is ready for pickup'
    when 'COMPLETED' then 'Your order is complete'
    when 'CANCELLED' then 'Your order was cancelled'
    else null
  end;
  if v_title is null then return new; end if;
  v_message := case new.status
    when 'PREPARING' then 'Staff started preparing your food and drinks order.'
    when 'READY' then 'Your food and drinks order is ready. Please collect it from staff.'
    when 'COMPLETED' then 'Your food and drinks order has been marked complete.'
    when 'CANCELLED' then 'Your food and drinks order was cancelled. Check its payment status in Your Activity.'
  end;
  insert into public.user_notifications(user_id, title, message)
  values (new.customer_id, v_title, v_message);
  return new;
end;
$$;

drop trigger if exists gamerhub_order_status_notification on public.orders;
create trigger gamerhub_order_status_notification
  after update of status on public.orders
  for each row execute function public.notify_gamerhub_order_status();

-- Home listens for a confirmed reservation before a session has been activated.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'reservations'
    ) then
    alter publication supabase_realtime add table public.reservations;
  end if;
end;
$$;

notify pgrst, 'reload schema';
