-- Pause a session by saving its unused paid seconds to a protected customer wallet.
-- The station is released; the saved balance can be used to reserve another station.

create table if not exists public.playtime_wallets (
  customer_id uuid primary key references public.profiles(id) on delete cascade,
  balance_seconds bigint not null default 0 check (balance_seconds >= 0),
  updated_at timestamptz not null default now()
);

alter table public.playtime_wallets enable row level security;
drop policy if exists "playtime wallet read self" on public.playtime_wallets;
create policy "playtime wallet read self" on public.playtime_wallets
  for select to authenticated using (customer_id = (select auth.uid()));
revoke all on public.playtime_wallets from anon, authenticated;
grant select on public.playtime_wallets to authenticated;

alter table public.reservations
  add column if not exists balance_seconds bigint not null default 0 check (balance_seconds >= 0);

alter table public.reservations drop constraint if exists reservations_status_check;
alter table public.reservations add constraint reservations_status_check
  check (status in ('PENDING_PAYMENT', 'CONFIRMED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'EXPIRED'));

alter table public.sessions drop constraint if exists sessions_status_check;
alter table public.sessions add constraint sessions_status_check
  check (status in ('ACTIVE', 'PAUSED', 'COMPLETED', 'TRANSFER_PENDING'));

insert into public.playtime_packages (id, name, duration_minutes, price, is_active)
values ('SAVED_BALANCE', 'Saved playtime balance', 1, 0, false)
on conflict (id) do update set name = excluded.name, duration_minutes = excluded.duration_minutes,
  price = excluded.price, is_active = false;

create or replace function public.restore_gamerhub_saved_balance_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.balance_seconds > 0 and old.status = 'CONFIRMED' and new.status in ('CANCELLED', 'EXPIRED') then
    insert into public.playtime_wallets (customer_id, balance_seconds)
    values (old.customer_id, old.balance_seconds)
    on conflict (customer_id) do update
      set balance_seconds = public.playtime_wallets.balance_seconds + excluded.balance_seconds,
          updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists gamerhub_restore_saved_balance on public.reservations;
create trigger gamerhub_restore_saved_balance
  after update of status on public.reservations
  for each row execute function public.restore_gamerhub_saved_balance_on_cancel();

create or replace function public.create_gamerhub_balance_reservation(p_station_id text)
returns public.reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid := auth.uid();
  v_balance bigint;
  v_started_at timestamptz := now();
  v_ends_at timestamptz;
  v_pin text;
  v_res public.reservations;
begin
  if v_customer is null then raise exception 'Sign in to use your saved playtime.'; end if;

  select balance_seconds into v_balance
  from public.playtime_wallets where customer_id = v_customer for update;
  if not found or v_balance <= 0 then raise exception 'You do not have saved playtime to use.'; end if;

  perform 1 from public.stations where id = p_station_id and status = 'AVAILABLE' for update;
  if not found then raise exception 'This station is not available.'; end if;

  v_ends_at := v_started_at + make_interval(secs => v_balance::double precision);
  if exists (
    select 1 from public.reservations r
    where r.station_id = p_station_id
      and r.status in ('PENDING_PAYMENT', 'CONFIRMED', 'ACTIVE')
      and (r.status <> 'PENDING_PAYMENT' or r.created_at > now() - interval '15 minutes')
      and tstzrange(r.start_at, r.ends_at, '[)') && tstzrange(v_started_at, v_ends_at, '[)')
  ) then raise exception 'This station was just reserved. Please choose another one.'; end if;

  loop
    v_pin := lpad(floor(random() * 1000000)::int::text, 6, '0');
    exit when not exists (select 1 from public.reservations where activation_pin = v_pin);
  end loop;

  update public.playtime_wallets
  set balance_seconds = 0, updated_at = now()
  where customer_id = v_customer;

  insert into public.reservations (
    customer_id, station_id, package_id, start_at, ends_at,
    total_amount, balance_seconds, status, activation_pin
  ) values (
    v_customer, p_station_id, 'SAVED_BALANCE', v_started_at, v_ends_at,
    0, v_balance, 'CONFIRMED', v_pin
  ) returning * into v_res;

  return v_res;
end;
$$;

revoke all on function public.create_gamerhub_balance_reservation(text) from public, anon;
grant execute on function public.create_gamerhub_balance_reservation(text) to authenticated;

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
  if not public.is_gamerhub_staff() then raise exception 'Staff access required.'; end if;

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found or v_res.status <> 'CONFIRMED' then raise exception 'Only confirmed reservations can be activated.'; end if;
  if p_pin is null or p_pin !~ '^\d{6}$' or v_res.activation_pin is distinct from p_pin then
    raise exception 'The reservation PIN does not match.';
  end if;
  if v_res.start_at > now() + interval '5 minutes' then raise exception 'This reservation has not reached its scheduled start time yet.'; end if;

  v_duration := v_res.ends_at - v_res.start_at;
  if v_duration <= interval '0 seconds' then raise exception 'This reservation has no valid playtime duration. Contact an administrator.'; end if;
  v_ends_at := v_started_at + v_duration;

  select status into v_station_status from public.stations where id = v_res.station_id for update;
  if not found or v_station_status not in ('AVAILABLE', 'RESERVED') then raise exception 'Station is not available to activate right now.'; end if;
  if exists (
    select 1 from public.reservations r
    where r.station_id = v_res.station_id and r.id <> v_res.id
      and r.status in ('PENDING_PAYMENT', 'CONFIRMED', 'ACTIVE')
      and (r.status <> 'PENDING_PAYMENT' or r.created_at > now() - interval '15 minutes')
      and tstzrange(r.start_at, r.ends_at, '[)') && tstzrange(v_started_at, v_ends_at, '[)')
  ) then raise exception 'Starting now would overlap another station booking. Choose another available station or contact the customer before activation.'; end if;

  update public.stations set status = 'OCCUPIED', updated_at = now()
  where id = v_res.station_id and status in ('AVAILABLE', 'RESERVED');
  if not found then raise exception 'Station is not available to activate right now.'; end if;

  insert into public.sessions (reservation_id, customer_id, station_id, started_at, ends_at)
  values (v_res.id, v_res.customer_id, v_res.station_id, v_started_at, v_ends_at)
  returning * into v_session;

  update public.reservations set status = 'ACTIVE', start_at = v_started_at, ends_at = v_ends_at where id = v_res.id;
  return v_session;
end;
$$;

revoke all on function public.activate_gamerhub_reservation_with_pin(uuid, text) from public, anon;
grant execute on function public.activate_gamerhub_reservation_with_pin(uuid, text) to authenticated;

drop function if exists public.end_gamerhub_session(uuid);
create function public.end_gamerhub_session(p_session_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions;
  v_remaining bigint;
  v_next_status text;
begin
  if auth.uid() is null then raise exception 'Sign in to pause this session.'; end if;

  select * into v_session from public.sessions
  where id = p_session_id and status = 'ACTIVE'
    and (customer_id = auth.uid() or public.is_gamerhub_staff())
  for update;
  if not found then raise exception 'Active session not found or you do not have permission to pause it.'; end if;

  v_remaining := greatest(0, ceil(extract(epoch from (v_session.ends_at - now())))::bigint);
  v_next_status := case when v_remaining > 0 then 'PAUSED' else 'COMPLETED' end;

  update public.sessions set status = v_next_status, ended_at = now() where id = v_session.id;
  if v_session.reservation_id is not null then
    update public.reservations
    set status = v_next_status,
        balance_seconds = case when v_next_status = 'PAUSED' then v_remaining else balance_seconds end
    where id = v_session.reservation_id and status = 'ACTIVE';
  end if;

  if v_remaining > 0 then
    insert into public.playtime_wallets (customer_id, balance_seconds)
    values (v_session.customer_id, v_remaining)
    on conflict (customer_id) do update
      set balance_seconds = public.playtime_wallets.balance_seconds + excluded.balance_seconds,
          updated_at = now();
  end if;

  perform public.sync_gamerhub_station_status(v_session.station_id);
  return v_remaining;
end;
$$;

revoke all on function public.end_gamerhub_session(uuid) from public, anon;
grant execute on function public.end_gamerhub_session(uuid) to authenticated;

notify pgrst, 'reload schema';
