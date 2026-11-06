-- Let each gamer control transactional email alerts for system updates.
alter table public.profiles
  add column if not exists email_notifications_enabled boolean not null default true;

grant update (email_notifications_enabled) on public.profiles to authenticated;

notify pgrst, 'reload schema';
