-- Admin-only controls for staff assignment and commercial catalog management.
create or replace function public.is_gamerhub_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;
revoke all on function public.is_gamerhub_admin() from public;
grant execute on function public.is_gamerhub_admin() to authenticated;

create or replace function public.set_gamerhub_staff_role(p_user_id uuid, p_role text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_gamerhub_admin() then
    raise exception 'Administrator access required.';
  end if;
  if p_role not in ('customer', 'staff') then
    raise exception 'Role must be customer or staff. Admin roles are assigned from the Supabase dashboard.';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'You cannot change your own role.';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  if not found then raise exception 'User not found.'; end if;
end;
$$;
revoke all on function public.set_gamerhub_staff_role(uuid, text) from public;
grant execute on function public.set_gamerhub_staff_role(uuid, text) to authenticated;

drop policy if exists "packages staff manage" on public.playtime_packages;
drop policy if exists "packages admin manage" on public.playtime_packages;
create policy "packages admin manage" on public.playtime_packages for all to authenticated
  using (public.is_gamerhub_admin()) with check (public.is_gamerhub_admin());

drop policy if exists "promos staff manage" on public.promo_packages;
drop policy if exists "promos admin manage" on public.promo_packages;
create policy "promos admin manage" on public.promo_packages for all to authenticated
  using (public.is_gamerhub_admin()) with check (public.is_gamerhub_admin());

grant insert, update, delete on public.playtime_packages, public.promo_packages to authenticated;
