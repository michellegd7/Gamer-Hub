-- Keep a transferred active session, its reservation, and station availability in sync.
-- Run after 20261113_gamerhub_shared_station_availability.sql.

create or replace function public.resolve_gamerhub_transfer_request(
  p_request_id uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.transfer_requests;
  v_session public.sessions;
  v_target_status text;
begin
  if not public.is_gamerhub_staff() then
    raise exception 'Staff access required.';
  end if;

  select *
    into v_request
    from public.transfer_requests
   where id = p_request_id
     and status = 'PENDING'
   for update;

  if not found then
    raise exception 'Pending transfer request not found.';
  end if;

  if p_approve then
    select *
      into v_session
      from public.sessions
     where id = v_request.session_id
       and customer_id = v_request.customer_id
       and status = 'ACTIVE'
       and ends_at > now()
     for update;

    if not found then
      raise exception 'The gamer session is no longer active.';
    end if;

    if v_session.station_id <> v_request.from_station_id then
      raise exception 'The gamer has already moved from the requested source station.';
    end if;

    -- Lock the destination so two staff approvals cannot claim it concurrently.
    select status
      into v_target_status
      from public.stations
     where id = v_request.to_station_id
     for update;

    if not found or v_target_status <> 'AVAILABLE'
       or exists (
         select 1 from public.sessions se
          where se.station_id = v_request.to_station_id
            and se.status = 'ACTIVE'
            and se.ends_at > now()
       )
       or exists (
         select 1 from public.reservations r
          where r.station_id = v_request.to_station_id
            and r.ends_at > now()
            and (
              r.status in ('CONFIRMED', 'ACTIVE')
              or (r.status = 'PENDING_PAYMENT' and r.created_at > now() - interval '15 minutes')
            )
            and tstzrange(r.start_at, r.ends_at, '[)')
                && tstzrange(now(), v_session.ends_at, '[)')
       ) then
      raise exception 'Requested station is no longer available.';
    end if;

    -- Move the reservation and session in the same transaction. This preserves
    -- the original booking, paid time, and end time while changing its station.
    if v_session.reservation_id is not null then
      update public.reservations
         set station_id = v_request.to_station_id
       where id = v_session.reservation_id
         and customer_id = v_request.customer_id
         and status = 'ACTIVE';

      if not found then
        raise exception 'The active reservation linked to this session could not be moved.';
      end if;
    end if;

    update public.sessions
       set station_id = v_request.to_station_id
     where id = v_session.id
       and status = 'ACTIVE';

    if not found then
      raise exception 'The active session could not be moved.';
    end if;

    update public.transfer_requests
       set status = 'APPROVED'
     where id = v_request.id;

    -- Trigger-based status sync (from migration 20261113) accounts for any
    -- other reservations/sessions that may still use either station.
    perform public.sync_gamerhub_station_status(v_request.from_station_id);
    perform public.sync_gamerhub_station_status(v_request.to_station_id);
  else
    update public.transfer_requests
       set status = 'DECLINED'
     where id = v_request.id;
  end if;
end;
$$;

revoke all on function public.resolve_gamerhub_transfer_request(uuid, boolean) from public;
grant execute on function public.resolve_gamerhub_transfer_request(uuid, boolean) to authenticated;

-- Let open staff workspaces receive transfer requests and decisions immediately.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'transfer_requests'
     ) then
    alter publication supabase_realtime add table public.transfer_requests;
  end if;
end;
$$;

notify pgrst, 'reload schema';
