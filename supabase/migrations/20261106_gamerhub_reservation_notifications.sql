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
create policy "Users can read their notifications"
  on public.user_notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can mark their notifications read" on public.user_notifications;
create policy "Users can mark their notifications read"
  on public.user_notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select on public.user_notifications to authenticated;
grant update (is_read) on public.user_notifications to authenticated;

create or replace function public.notify_reservation_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_station_name text;
begin
  select name into v_station_name from public.stations where id = new.station_id;

  insert into public.user_notifications (user_id, reservation_id, title, message)
  values (
    new.customer_id,
    new.id,
    'Reservation PIN ready',
    coalesce(v_station_name, new.station_id) || ' is reserved. Find your six-digit activation PIN on the reservation activation screen. Keep it private and show it to staff when starting your session.'
  );

  return new;
end;
$$;

drop trigger if exists reservation_created_notification on public.reservations;
create trigger reservation_created_notification
  after insert on public.reservations
  for each row execute function public.notify_reservation_created();

notify pgrst, 'reload schema';
