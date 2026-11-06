-- Link food orders to the same pending/verified payment ledger as reservations and extensions.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payments_order_id_fkey'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
      add constraint payments_order_id_fkey
      foreign key (order_id) references public.orders(id) on delete cascade;
  end if;
end;
$$;

create unique index if not exists payments_one_order
  on public.payments(order_id) where order_id is not null;

create or replace function public.create_gamerhub_food_order(p_items jsonb, p_method text)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if auth.uid() is null then
    raise exception 'Sign in to place an order.';
  end if;
  if p_method is null or p_method not in ('GCash', 'Maya', 'Counter') then
    raise exception 'Choose a supported payment method.';
  end if;

  v_order := public.create_gamerhub_order(p_items);

  insert into public.payments (customer_id, order_id, amount, method)
  values (auth.uid(), v_order.id, v_order.total_amount, p_method);

  return v_order;
end;
$$;

revoke all on function public.create_gamerhub_food_order(jsonb, text) from public;
grant execute on function public.create_gamerhub_food_order(jsonb, text) to authenticated;

-- Keep order status changes and unpaid order payment records in sync.
create or replace function public.update_gamerhub_order_status(p_order_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if not public.is_gamerhub_staff() then
    raise exception 'Staff access required.';
  end if;
  if p_status not in ('PREPARING', 'READY', 'COMPLETED', 'CANCELLED') then
    raise exception 'Unsupported order status.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if not (
    (v_order.status = 'PLACED' and p_status in ('PREPARING', 'CANCELLED')) or
    (v_order.status = 'PREPARING' and p_status in ('READY', 'CANCELLED')) or
    (v_order.status = 'READY' and p_status = 'COMPLETED')
  ) then
    raise exception 'This order can no longer move to that status.';
  end if;

  update public.orders set status = p_status where id = p_order_id;
  if p_status = 'CANCELLED' then
    update public.payments set status = 'FAILED'
      where order_id = p_order_id and status = 'PENDING';
  end if;
end;
$$;

revoke all on function public.update_gamerhub_order_status(uuid, text) from public;
grant execute on function public.update_gamerhub_order_status(uuid, text) to authenticated;
