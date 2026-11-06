-- Remove only the signed-in user's registration for this device.
create or replace function public.unregister_gamerhub_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to unregister notifications.'; end if;
  if p_token is null or length(p_token) > 512 then raise exception 'Invalid push token.'; end if;

  delete from public.gamerhub_push_tokens
  where user_id = auth.uid() and expo_push_token = p_token;
end;
$$;

revoke all on function public.unregister_gamerhub_push_token(text) from public, anon;
grant execute on function public.unregister_gamerhub_push_token(text) to authenticated;

notify pgrst, 'reload schema';
