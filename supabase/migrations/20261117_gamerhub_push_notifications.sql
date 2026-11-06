-- Store per-device Expo push tokens and dispatch notification rows to the
-- GamerHub Edge Function. The webhook secret is stored in Supabase Vault.

create extension if not exists pg_net;

create table if not exists public.gamerhub_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gamerhub_push_tokens_user on public.gamerhub_push_tokens(user_id);
alter table public.gamerhub_push_tokens enable row level security;
revoke all on public.gamerhub_push_tokens from anon, authenticated;

create or replace function public.register_gamerhub_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to register notifications.'; end if;
  if p_token is null or length(p_token) > 512 then raise exception 'Invalid push token.'; end if;
  if p_platform not in ('android', 'ios') then raise exception 'Unsupported push platform.'; end if;

  insert into public.gamerhub_push_tokens(user_id, expo_push_token, platform)
  values (auth.uid(), p_token, p_platform)
  on conflict (expo_push_token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

revoke all on function public.register_gamerhub_push_token(text, text) from public, anon;
grant execute on function public.register_gamerhub_push_token(text, text) to authenticated;

create or replace function public.dispatch_gamerhub_push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  begin
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'gamerhub_push_webhook_secret'
    limit 1;
  exception when others then
    -- Keep in-app notification inserts working until push is configured.
    return new;
  end;

  if v_secret is null or v_secret = '' then return new; end if;

  perform net.http_post(
    url := 'https://bcygymygeeilobzceuyr.supabase.co/functions/v1/gamerhub-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-gamerhub-push-secret', v_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'user_notifications',
      'schema', 'public',
      'record', to_jsonb(new),
      'old_record', null
    )
  );
  return new;
exception when others then
  -- Push delivery failure must never roll back the durable in-app notification.
  return new;
end;
$$;

drop trigger if exists gamerhub_push_notification_insert on public.user_notifications;
create trigger gamerhub_push_notification_insert
  after insert on public.user_notifications
  for each row execute function public.dispatch_gamerhub_push_notification();

notify pgrst, 'reload schema';
