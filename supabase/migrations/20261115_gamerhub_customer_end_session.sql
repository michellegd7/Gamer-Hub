-- Allow a gamer to end only their own active session; staff retain the admin action.
-- Requires the shared station availability migration (20261113).

create or replace function public.end_gamerhub_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_station_id text;
  v_reservation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to end this session.';
  end if;

  update public.sessions
     set status = 'COMPLETED',
         ended_at = now()
   where id = p_session_id
     and status = 'ACTIVE'
     and (customer_id = auth.uid() or public.is_gamerhub_staff())
  returning station_id, reservation_id
       into v_station_id, v_reservation_id;

  if v_station_id is null then
    raise exception 'Active session not found or you do not have permission to end it.';
  end if;

  if v_reservation_id is not null then
    update public.reservations
       set status = 'COMPLETED'
     where id = v_reservation_id
       and status in ('ACTIVE', 'CONFIRMED');
  end if;

  perform public.sync_gamerhub_station_status(v_station_id);
end;
$$;

revoke all on function public.end_gamerhub_session(uuid) from public;
grant execute on function public.end_gamerhub_session(uuid) to authenticated;

notify pgrst, 'reload schema';
