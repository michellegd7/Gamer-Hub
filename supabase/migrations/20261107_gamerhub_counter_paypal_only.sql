-- Customer checkout supports Pay at the Counter and PayPal only.
-- Keep old payment ledger values accepted so historical rows remain readable.
update public.profiles
set preferred_payment_method = 'Counter'
where preferred_payment_method in ('GCash', 'Maya');

alter table public.profiles
  alter column preferred_payment_method set default 'Counter';
alter table public.profiles
  drop constraint if exists profiles_preferred_payment_method_check;
alter table public.profiles
  add constraint profiles_preferred_payment_method_check
  check (preferred_payment_method in ('Counter', 'PayPal'));

create or replace function public.create_gamerhub_payment(p_reservation_id uuid, p_method text)
returns public.payments language plpgsql security definer set search_path = public
as $$
declare v_payment public.payments; v_res public.reservations;
begin
  if auth.uid() is null then raise exception 'Sign in to continue.'; end if;
  if p_method is null or p_method not in ('Counter', 'PayPal') then raise exception 'Choose PayPal or pay at the counter.'; end if;
  select * into v_res from public.reservations where id = p_reservation_id and customer_id = auth.uid() for update;
  if not found or v_res.status <> 'PENDING_PAYMENT' then raise exception 'Reservation is not awaiting payment.'; end if;
  select * into v_payment from public.payments where reservation_id = v_res.id and status = 'PENDING' for update;
  if found then
    if v_payment.method <> p_method then raise exception 'A payment is already pending for this reservation. Continue with the selected method or ask staff to reset it.'; end if;
    return v_payment;
  end if;
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
  if p_method is null or p_method not in ('Counter', 'PayPal') then raise exception 'Choose PayPal or pay at the counter.'; end if;
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

create or replace function public.create_gamerhub_food_order(p_items jsonb, p_method text)
returns public.orders language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  if auth.uid() is null then raise exception 'Sign in to place an order.'; end if;
  if p_method is null or p_method not in ('Counter', 'PayPal') then raise exception 'Choose PayPal or pay at the counter.'; end if;
  v_order := public.create_gamerhub_order(p_items);
  insert into public.payments (customer_id, order_id, amount, method)
  values (auth.uid(), v_order.id, v_order.total_amount, p_method);
  return v_order;
end;
$$;
revoke all on function public.create_gamerhub_food_order(jsonb, text) from public;
grant execute on function public.create_gamerhub_food_order(jsonb, text) to authenticated;

notify pgrst, 'reload schema';
