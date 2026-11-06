-- GamerHub core schema. Apply this migration in Supabase before enabling app data flows.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  first_name text not null default '',
  middle_name text not null default '',
  last_name text not null default '',
  username text not null unique,
  age smallint,
  gender text,
  role text not null default 'customer' check (role in ('customer', 'staff', 'admin')),
  created_at timestamptz not null default now()
);

create or replace function public.is_gamerhub_staff()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('staff', 'admin')
  );
$$;

-- Auth metadata creates customer profile data only. Staff roles must be granted by an admin.
create or replace function public.handle_new_gamerhub_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, middle_name, last_name, username, age, gender)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'middle_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data->>'age', '')::smallint,
    new.raw_user_meta_data->>'gender'
  ) on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_gamerhub_user_created on auth.users;
create trigger on_gamerhub_user_created after insert on auth.users
for each row execute procedure public.handle_new_gamerhub_user();

insert into public.profiles (id, email, first_name, middle_name, last_name, username, age, gender)
select id, coalesce(email, ''), coalesce(raw_user_meta_data->>'first_name', ''),
  coalesce(raw_user_meta_data->>'middle_name', ''), coalesce(raw_user_meta_data->>'last_name', ''),
  coalesce(nullif(raw_user_meta_data->>'username', ''), split_part(email, '@', 1) || '_' || left(id::text, 6)),
  nullif(raw_user_meta_data->>'age', '')::smallint, raw_user_meta_data->>'gender'
from auth.users on conflict (id) do nothing;

create table if not exists public.stations (
  id text primary key,
  name text not null unique,
  station_type text not null default 'PC' check (station_type in ('PC', 'PlayStation', 'Xbox', 'VIP')),
  gpu text not null default '', processor text not null default '', ram text not null default '', monitor text not null default '',
  hourly_rate numeric(10,2) not null check (hourly_rate >= 0),
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE', 'RESERVED', 'OCCUPIED', 'MAINTENANCE')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.playtime_packages (
  id text primary key, name text not null, duration_minutes integer not null check (duration_minutes > 0),
  price numeric(10,2) not null check (price >= 0), is_active boolean not null default true
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id), station_id text not null references public.stations(id),
  package_id text not null references public.playtime_packages(id), start_at timestamptz not null, ends_at timestamptz not null,
  total_amount numeric(10,2) not null check (total_amount >= 0), status text not null default 'PENDING_PAYMENT'
    check (status in ('PENDING_PAYMENT', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED')),
  activation_pin text not null unique, created_at timestamptz not null default now()
);
create index if not exists reservations_customer_created on public.reservations(customer_id, created_at desc);
create index if not exists reservations_station_time on public.reservations(station_id, start_at, ends_at);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(), reservation_id uuid unique references public.reservations(id),
  customer_id uuid not null references public.profiles(id), station_id text not null references public.stations(id),
  started_at timestamptz not null default now(), ends_at timestamptz not null, ended_at timestamptz,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'COMPLETED', 'TRANSFER_PENDING')),
  created_at timestamptz not null default now()
);
create index if not exists sessions_active_station on public.sessions(station_id) where status = 'ACTIVE';

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id), reservation_id uuid references public.reservations(id),
  session_id uuid references public.sessions(id), order_id uuid, extension_minutes integer,
  amount numeric(10,2) not null check (amount >= 0), method text not null check (method in ('GCash', 'Maya', 'Counter')),
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'FAILED', 'REFUNDED')),
  provider_reference text, created_at timestamptz not null default now()
);
create unique index if not exists payments_one_reservation on public.payments(reservation_id) where reservation_id is not null;

create table if not exists public.food_items (
  id text primary key, name text not null, category text not null, emoji text not null default '🍽️',
  price numeric(10,2) not null check (price >= 0), is_available boolean not null default true
);
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id), session_id uuid references public.sessions(id),
  status text not null default 'PLACED' check (status in ('PLACED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED')),
  total_amount numeric(10,2) not null check (total_amount >= 0), created_at timestamptz not null default now()
);
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
  food_item_id text not null references public.food_items(id), quantity integer not null check (quantity > 0), unit_price numeric(10,2) not null check (unit_price >= 0)
);

create or replace function public.create_gamerhub_order(p_items jsonb)
returns public.orders language plpgsql security definer set search_path = public
as $$
declare v_order public.orders; v_total numeric(10,2); v_expected integer; v_valid integer; v_session uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to order.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Your cart is empty.'; end if;
  select count(*) into v_expected from jsonb_to_recordset(p_items) as x(id text, quantity integer);
  select count(*), coalesce(sum(f.price * x.quantity), 0) into v_valid, v_total
    from jsonb_to_recordset(p_items) as x(id text, quantity integer)
    join public.food_items f on f.id = x.id and f.is_available
    where x.quantity > 0;
  if v_valid <> v_expected then raise exception 'One or more menu items are unavailable.'; end if;
  select id into v_session from public.sessions where customer_id = auth.uid() and status = 'ACTIVE' limit 1;
  insert into public.orders (customer_id, session_id, total_amount) values (auth.uid(), v_session, v_total) returning * into v_order;
  insert into public.order_items (order_id, food_item_id, quantity, unit_price)
    select v_order.id, f.id, x.quantity, f.price
    from jsonb_to_recordset(p_items) as x(id text, quantity integer)
    join public.food_items f on f.id = x.id and f.is_available;
  return v_order;
end;
$$;
revoke all on function public.create_gamerhub_order(jsonb) from public;
grant execute on function public.create_gamerhub_order(jsonb) to authenticated;
revoke insert on public.orders, public.order_items from authenticated;

create table if not exists public.transfer_requests (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.sessions(id), customer_id uuid not null references public.profiles(id),
  from_station_id text not null references public.stations(id), to_station_id text not null references public.stations(id), reason text not null default '',
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED')), created_at timestamptz not null default now()
);
create or replace function public.create_gamerhub_transfer_request(p_session_id uuid, p_target_station text, p_reason text default '')
returns public.transfer_requests language plpgsql security definer set search_path = public
as $$
declare v_session public.sessions; v_request public.transfer_requests;
begin
  if auth.uid() is null then raise exception 'Sign in to request a transfer.'; end if;
  select * into v_session from public.sessions where id = p_session_id and customer_id = auth.uid() and status = 'ACTIVE' for update;
  if not found then raise exception 'Active session not found.'; end if;
  if p_target_station = v_session.station_id or not exists (select 1 from public.stations where id = p_target_station and status = 'AVAILABLE') then
    raise exception 'Choose a different available station.';
  end if;
  insert into public.transfer_requests (session_id, customer_id, from_station_id, to_station_id, reason)
  values (v_session.id, auth.uid(), v_session.station_id, p_target_station, coalesce(p_reason, '')) returning * into v_request;
  return v_request;
end;
$$;
revoke all on function public.create_gamerhub_transfer_request(uuid, text, text) from public;
grant execute on function public.create_gamerhub_transfer_request(uuid, text, text) to authenticated;

create or replace function public.resolve_gamerhub_transfer_request(p_request_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public
as $$
declare v_request public.transfer_requests;
begin
  if not public.is_gamerhub_staff() then raise exception 'Staff access required.'; end if;
  select * into v_request from public.transfer_requests where id = p_request_id and status = 'PENDING' for update;
  if not found then raise exception 'Pending transfer request not found.'; end if;
  if p_approve then
    update public.stations set status = 'OCCUPIED', updated_at = now() where id = v_request.to_station_id and status = 'AVAILABLE';
    if not found then raise exception 'Requested station is no longer available.'; end if;
    update public.stations set status = 'AVAILABLE', updated_at = now() where id = v_request.from_station_id;
    update public.sessions set station_id = v_request.to_station_id where id = v_request.session_id and status = 'ACTIVE';
    update public.transfer_requests set status = 'APPROVED' where id = v_request.id;
  else
    update public.transfer_requests set status = 'DECLINED' where id = v_request.id;
  end if;
end;
$$;
revoke all on function public.resolve_gamerhub_transfer_request(uuid, boolean) from public;
grant execute on function public.resolve_gamerhub_transfer_request(uuid, boolean) to authenticated;
create table if not exists public.waitlist_entries (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id), station_type text not null,
  status text not null default 'WAITING' check (status in ('WAITING', 'NOTIFIED', 'CLAIMED', 'CANCELLED')), created_at timestamptz not null default now()
);
create unique index if not exists waitlist_one_active_per_customer on public.waitlist_entries(customer_id) where status = 'WAITING';
create or replace function public.join_gamerhub_waitlist(p_station_type text)
returns public.waitlist_entries language plpgsql security definer set search_path = public
as $$
declare v_entry public.waitlist_entries;
begin
  if auth.uid() is null then raise exception 'Sign in to join the waitlist.'; end if;
  if p_station_type not in ('PC', 'VIP', 'PlayStation', 'Xbox') then raise exception 'Choose a valid station type.'; end if;
  if exists (select 1 from public.waitlist_entries where customer_id = auth.uid() and status = 'WAITING') then
    raise exception 'You already have an active waitlist entry.';
  end if;
  insert into public.waitlist_entries (customer_id, station_type) values (auth.uid(), p_station_type) returning * into v_entry;
  return v_entry;
end;
$$;
revoke all on function public.join_gamerhub_waitlist(text) from public;
grant execute on function public.join_gamerhub_waitlist(text) to authenticated;
create or replace function public.get_gamerhub_waitlist_position(p_entry_id uuid)
returns integer language plpgsql stable security definer set search_path = public
as $$
declare v_type text; v_created timestamptz; v_position integer;
begin
  select station_type, created_at into v_type, v_created from public.waitlist_entries
    where id = p_entry_id and customer_id = auth.uid() and status = 'WAITING';
  if not found then return null; end if;
  select count(*)::integer into v_position from public.waitlist_entries
    where station_type = v_type and status = 'WAITING' and created_at <= v_created;
  return v_position;
end;
$$;
revoke all on function public.get_gamerhub_waitlist_position(uuid) from public;
grant execute on function public.get_gamerhub_waitlist_position(uuid) to authenticated;
create table if not exists public.maintenance_records (
  id uuid primary key default gen_random_uuid(), station_id text not null references public.stations(id), reported_by uuid references public.profiles(id),
  issue text not null, status text not null default 'OPEN' check (status in ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
  created_at timestamptz not null default now(), resolved_at timestamptz
);
create table if not exists public.promo_packages (
  id uuid primary key default gen_random_uuid(), name text not null, description text not null default '',
  duration_minutes integer not null check (duration_minutes > 0), price numeric(10,2) not null check (price >= 0),
  starts_at timestamptz, ends_at timestamptz, is_active boolean not null default true
);

-- Booking RPC calculates the price on the server and prevents overlapping live bookings.
create or replace function public.create_gamerhub_reservation(p_station_id text, p_package_id text, p_start_at timestamptz default now())
returns public.reservations
language plpgsql security definer set search_path = public
as $$
declare v_res public.reservations; v_minutes integer; v_price numeric; v_pin text;
begin
  if auth.uid() is null then raise exception 'Sign in to reserve a station.'; end if;
  select duration_minutes, price into v_minutes, v_price from public.playtime_packages where id = p_package_id and is_active;
  if v_minutes is null then raise exception 'This playtime package is unavailable.'; end if;
  perform 1 from public.stations where id = p_station_id and status = 'AVAILABLE' for update;
  if not found then raise exception 'This station is not available.'; end if;
  if exists (
    select 1 from public.reservations r where r.station_id = p_station_id and r.status in ('PENDING_PAYMENT', 'CONFIRMED', 'ACTIVE')
      and (r.status <> 'PENDING_PAYMENT' or r.created_at > now() - interval '15 minutes')
      and tstzrange(r.start_at, r.ends_at, '[)') && tstzrange(p_start_at, p_start_at + make_interval(mins => v_minutes), '[)')
  ) then raise exception 'This station was just reserved. Please choose another one.'; end if;
  loop
    v_pin := lpad(floor(random() * 1000000)::int::text, 6, '0');
    exit when not exists (select 1 from public.reservations where activation_pin = v_pin);
  end loop;
  insert into public.reservations (customer_id, station_id, package_id, start_at, ends_at, total_amount, activation_pin)
  values (auth.uid(), p_station_id, p_package_id, p_start_at, p_start_at + make_interval(mins => v_minutes), v_price, v_pin)
  returning * into v_res;
  return v_res;
end;
$$;
revoke all on function public.create_gamerhub_reservation(text, text, timestamptz) from public;
grant execute on function public.create_gamerhub_reservation(text, text, timestamptz) to authenticated;

create or replace function public.create_gamerhub_payment(p_reservation_id uuid, p_method text)
returns public.payments language plpgsql security definer set search_path = public
as $$
declare v_payment public.payments; v_res public.reservations;
begin
  if auth.uid() is null then raise exception 'Sign in to continue.'; end if;
  if p_method not in ('GCash', 'Maya', 'Counter') then raise exception 'Choose a supported payment method.'; end if;
  select * into v_res from public.reservations where id = p_reservation_id and customer_id = auth.uid() for update;
  if not found or v_res.status <> 'PENDING_PAYMENT' then raise exception 'Reservation is not awaiting payment.'; end if;
  insert into public.payments (customer_id, reservation_id, amount, method)
  values (auth.uid(), v_res.id, v_res.total_amount, p_method) returning * into v_payment;
  return v_payment;
end;
$$;
revoke all on function public.create_gamerhub_payment(uuid, text) from public;
grant execute on function public.create_gamerhub_payment(uuid, text) to authenticated;

create or replace function public.create_gamerhub_extension_payment(p_session_id uuid, p_package_id text, p_method text)
returns public.payments language plpgsql security definer set search_path = public
as $$
declare v_session public.sessions; v_package public.playtime_packages; v_payment public.payments;
begin
  if auth.uid() is null then raise exception 'Sign in to extend your session.'; end if;
  if p_method not in ('GCash', 'Maya', 'Counter') then raise exception 'Choose a supported payment method.'; end if;
  select * into v_session from public.sessions where id = p_session_id and customer_id = auth.uid() and status = 'ACTIVE' for update;
  if not found then raise exception 'Active session not found.'; end if;
  select * into v_package from public.playtime_packages where id = p_package_id and is_active;
  if not found then raise exception 'This extension package is unavailable.'; end if;
  insert into public.payments (customer_id, session_id, amount, method, extension_minutes)
  values (auth.uid(), v_session.id, v_package.price, p_method, v_package.duration_minutes) returning * into v_payment;
  return v_payment;
end;
$$;
revoke all on function public.create_gamerhub_extension_payment(uuid, text, text) from public;
grant execute on function public.create_gamerhub_extension_payment(uuid, text, text) to authenticated;

create or replace function public.verify_gamerhub_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_payment public.payments;
begin
  if not public.is_gamerhub_staff() then raise exception 'Staff access required.'; end if;
  select * into v_payment from public.payments where id = p_payment_id and status = 'PENDING' for update;
  if not found then raise exception 'Pending payment not found.'; end if;
  update public.payments set status = 'PAID' where id = v_payment.id;
  if v_payment.reservation_id is not null then
    update public.reservations set status = 'CONFIRMED' where id = v_payment.reservation_id and status = 'PENDING_PAYMENT';
  elsif v_payment.session_id is not null then
    update public.sessions set ends_at = greatest(ends_at, now()) + make_interval(mins => coalesce(v_payment.extension_minutes, 0))
      where id = v_payment.session_id and status = 'ACTIVE';
  end if;
end;
$$;
revoke all on function public.verify_gamerhub_payment(uuid) from public;
grant execute on function public.verify_gamerhub_payment(uuid) to authenticated;

create or replace function public.activate_gamerhub_reservation(p_reservation_id uuid)
returns public.sessions language plpgsql security definer set search_path = public
as $$
declare v_res public.reservations; v_session public.sessions;
begin
  if not public.is_gamerhub_staff() then raise exception 'Staff access required.'; end if;
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found or v_res.status <> 'CONFIRMED' then raise exception 'Only confirmed reservations can be activated.'; end if;
  update public.stations set status = 'OCCUPIED', updated_at = now() where id = v_res.station_id and status = 'AVAILABLE';
  if not found then raise exception 'Station is not available.'; end if;
  insert into public.sessions (reservation_id, customer_id, station_id, ends_at)
  values (v_res.id, v_res.customer_id, v_res.station_id, v_res.ends_at) returning * into v_session;
  update public.reservations set status = 'ACTIVE' where id = v_res.id;
  return v_session;
end;
$$;
revoke all on function public.activate_gamerhub_reservation(uuid) from public;
grant execute on function public.activate_gamerhub_reservation(uuid) to authenticated;

create or replace function public.end_gamerhub_session(p_session_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_station text; v_reservation uuid;
begin
  if not public.is_gamerhub_staff() then raise exception 'Staff access required.'; end if;
  update public.sessions set status = 'COMPLETED', ended_at = now()
    where id = p_session_id and status = 'ACTIVE' returning station_id, reservation_id into v_station, v_reservation;
  if v_station is null then raise exception 'Active session not found.'; end if;
  update public.stations set status = 'AVAILABLE', updated_at = now() where id = v_station;
  update public.reservations set status = 'COMPLETED' where id = v_reservation;
end;
$$;
revoke all on function public.end_gamerhub_session(uuid) from public;
grant execute on function public.end_gamerhub_session(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.stations enable row level security;
alter table public.playtime_packages enable row level security;
alter table public.reservations enable row level security;
alter table public.sessions enable row level security;
alter table public.payments enable row level security;
alter table public.food_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.transfer_requests enable row level security;
alter table public.waitlist_entries enable row level security;
alter table public.maintenance_records enable row level security;
alter table public.promo_packages enable row level security;

-- Public catalogue reads; all modifications require a staff role.
DROP POLICY IF EXISTS "profiles read self or staff" ON public.profiles;
CREATE POLICY "profiles read self or staff"
ON public.profiles
FOR SELECT
TO authenticated
USING (id = (SELECT auth.uid()) OR public.is_gamerhub_staff());
revoke update on public.profiles from authenticated;
grant update (first_name, middle_name, last_name, username, age, gender) on public.profiles to authenticated;
create policy "profiles update self" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "stations public read" on public.stations for select to anon, authenticated using (true);
create policy "stations staff manage" on public.stations for all to authenticated using (public.is_gamerhub_staff()) with check (public.is_gamerhub_staff());
create policy "packages public read" on public.playtime_packages for select to anon, authenticated using (is_active or public.is_gamerhub_staff());
create policy "packages staff manage" on public.playtime_packages for all to authenticated using (public.is_gamerhub_staff()) with check (public.is_gamerhub_staff());
create policy "promos public read" on public.promo_packages for select to anon, authenticated using (is_active or public.is_gamerhub_staff());
create policy "promos staff manage" on public.promo_packages for all to authenticated using (public.is_gamerhub_staff()) with check (public.is_gamerhub_staff());
create policy "reservations owner or staff read" on public.reservations for select to authenticated using (customer_id = (select auth.uid()) or public.is_gamerhub_staff());
create policy "reservations staff update" on public.reservations for update to authenticated using (public.is_gamerhub_staff()) with check (public.is_gamerhub_staff());
create policy "sessions owner or staff read" on public.sessions for select to authenticated using (customer_id = (select auth.uid()) or public.is_gamerhub_staff());
create policy "sessions staff manage" on public.sessions for all to authenticated using (public.is_gamerhub_staff()) with check (public.is_gamerhub_staff());
create policy "payments owner or staff read" on public.payments for select to authenticated using (customer_id = (select auth.uid()) or public.is_gamerhub_staff());
create policy "payments staff update" on public.payments for update to authenticated using (public.is_gamerhub_staff()) with check (public.is_gamerhub_staff());
create policy "food public read" on public.food_items for select to anon, authenticated using (is_available or public.is_gamerhub_staff());
create policy "food staff manage" on public.food_items for all to authenticated using (public.is_gamerhub_staff()) with check (public.is_gamerhub_staff());
create policy "orders owner or staff read" on public.orders for select to authenticated using (customer_id = (select auth.uid()) or public.is_gamerhub_staff());
create policy "orders staff update" on public.orders for update to authenticated using (public.is_gamerhub_staff()) with check (public.is_gamerhub_staff());
create policy "order items owner or staff read" on public.order_items for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = (select auth.uid()) or public.is_gamerhub_staff())));
create policy "transfer owner or staff read" on public.transfer_requests for select to authenticated using (customer_id = (select auth.uid()) or public.is_gamerhub_staff());
create policy "transfer staff update" on public.transfer_requests for update to authenticated using (public.is_gamerhub_staff()) with check (public.is_gamerhub_staff());
create policy "waitlist owner or staff read" on public.waitlist_entries for select to authenticated using (customer_id = (select auth.uid()) or public.is_gamerhub_staff());
create policy "waitlist owner create" on public.waitlist_entries for insert to authenticated with check (customer_id = (select auth.uid()));
create policy "waitlist owner cancel" on public.waitlist_entries for update to authenticated using (customer_id = (select auth.uid())) with check (customer_id = (select auth.uid()) and status = 'CANCELLED');
create policy "waitlist staff update" on public.waitlist_entries for update to authenticated using (public.is_gamerhub_staff()) with check (public.is_gamerhub_staff());
create policy "maintenance staff read" on public.maintenance_records for select to authenticated using (public.is_gamerhub_staff());
create policy "maintenance staff manage" on public.maintenance_records for all to authenticated using (public.is_gamerhub_staff()) with check (public.is_gamerhub_staff());

grant usage on schema public to anon, authenticated;
grant select on public.stations, public.playtime_packages, public.food_items, public.promo_packages to anon, authenticated;
grant select on public.profiles, public.reservations, public.sessions, public.payments, public.orders,
  public.order_items, public.transfer_requests, public.waitlist_entries, public.maintenance_records to authenticated;
grant update on public.stations, public.orders, public.transfer_requests, public.waitlist_entries, public.maintenance_records to authenticated;

insert into public.stations (id, name, station_type, gpu, processor, ram, monitor, hourly_rate, status) values
 ('PC01','PC 01','PC','RTX 2040','Intel Core i7','16 GB DDR4','27" 200Hz',50,'AVAILABLE'),
 ('PC02','PC 02','PC','RTX 2050','Intel Core i7','16 GB DDR4','27" 200Hz',60,'AVAILABLE'),
 ('PC03','PC 03','PC','RTX 2060','Intel Core i7','16 GB DDR4','27" 200Hz',70,'AVAILABLE'),
 ('VIP01','VIP 01','VIP','RTX 2070','Intel Core i9','32 GB DDR5','32" 240Hz',100,'AVAILABLE'),
 ('PC04','PC 04','PC','RTX 2040','Intel Core i7','16 GB DDR4','27" 200Hz',50,'AVAILABLE'),
 ('PC05','PC 05','PC','RTX 2050','Intel Core i7','16 GB DDR4','27" 200Hz',60,'AVAILABLE'),
 ('PC06','PC 06','PC','RTX 2060','Intel Core i7','16 GB DDR4','27" 200Hz',70,'AVAILABLE'),
 ('VIP02','VIP 02','VIP','RTX 3070','Intel Core i9','32 GB DDR5','32" 240Hz',120,'AVAILABLE'),
 ('PS01','PS 01','PlayStation','PlayStation 5','DualSense Wireless','Console','55" 4K UHD',80,'AVAILABLE'),
 ('PS02','PS 02','PlayStation','PlayStation 5','DualSense Wireless','Console','55" 4K UHD',80,'AVAILABLE')
on conflict (id) do nothing;
insert into public.playtime_packages (id, name, duration_minutes, price) values
 ('1','1 hour',60,50), ('3','3 hours',180,180), ('5','5 hours',300,300), ('10','10 hours',600,600),
 ('10m','10 minutes',10,10), ('30m','30 minutes',30,30), ('1h','1 hour extension',60,60),
 ('2h','2 hour extension',120,120), ('3h','3 hour extension',180,180), ('5h','5 hour extension',300,300)
on conflict (id) do nothing;
insert into public.food_items (id, name, category, emoji, price) values
 ('1','Pancit Canton','Snacks','🍜',40), ('2','Cheese Burger','Snacks','🍔',120), ('3','Coca-Cola','Drinks','🥤',25), ('4','Bottled Water','Drinks','💧',15)
on conflict (id) do nothing;
