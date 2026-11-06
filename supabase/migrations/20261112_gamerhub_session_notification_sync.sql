-- Keep customer notifications synchronized with reservations and live sessions.
-- Safe to re-run after the core and user_notifications migrations are installed.

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete cascade,
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists user_notifications_user_created
  on public.user_notifications(user_id, created_at desc);
alter table public.user_notifications enable row level security;
drop policy if exists "Users can read their notifications" on public.user_notifications;
create policy "Users can read their notifications" on public.user_notifications
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Users can mark their notifications read" on public.user_notifications;
create policy "Users can mark their notifications read" on public.user_notifications
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select on public.user_notifications to authenticated;
grant update (is_read) on public.user_notifications to authenticated;

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
  elsif new.status = 'COMPLETED' then
    v_title := 'Session completed';
    v_message := 'Your session at ' || coalesce(v_station_name, new.station_id) || ' has ended. You can review it in Your Activity.';
  else
    -- The session insert below sends the start notice exactly once.
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

drop trigger if exists gamerhub_session_started_notification on public.sessions;
create or replace function public.notify_gamerhub_session_started()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_station_name text;
begin
  select name into v_station_name from public.stations where id = new.station_id;
  insert into public.user_notifications(user_id, reservation_id, title, message)
  values (
    new.customer_id,
    new.reservation_id,
    'Your gaming session has started',
    'Your session at ' || coalesce(v_station_name, new.station_id) || ' is active. Your live remaining time is available on Home under Session Timer.'
  );
  return new;
end;
$$;
create trigger gamerhub_session_started_notification
  after insert on public.sessions
  for each row execute function public.notify_gamerhub_session_started();

-- Backfill notices for existing confirmed bookings and running sessions.
insert into public.user_notifications(user_id, reservation_id, title, message)
select r.customer_id, r.id,
  case when r.status = 'ACTIVE' then 'Your gaming session has started' else 'Reservation confirmed · PIN ready' end,
  case when r.status = 'ACTIVE'
    then 'Your session at ' || st.name || ' is active. Your live remaining time is available on Home under Session Timer.'
    else st.name || ' is confirmed. Open Your Activity → Sessions to view your six-digit activation PIN, then show it to staff when you arrive.'
  end
from public.reservations r
join public.stations st on st.id = r.station_id
where r.status in ('CONFIRMED', 'ACTIVE')
  and not exists (
    select 1 from public.user_notifications n
    where n.reservation_id = r.id
      and n.title = case when r.status = 'ACTIVE' then 'Your gaming session has started' else 'Reservation confirmed · PIN ready' end
  );

-- Enable instant refreshes for the customer home timer and notifications.
do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array['sessions', 'reservations', 'user_notifications'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end;
$$;

notify pgrst, 'reload schema';
