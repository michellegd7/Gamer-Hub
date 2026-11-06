-- Profile fields used by Personal Information, Address, and Payment Methods screens.
alter table public.profiles
  add column if not exists address_line text not null default '',
  add column if not exists barangay text not null default '',
  add column if not exists city text not null default '',
  add column if not exists province text not null default '',
  add column if not exists postal_code text not null default '',
  add column if not exists country text not null default 'Philippines',
  add column if not exists preferred_payment_method text not null default 'GCash';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_preferred_payment_method_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_preferred_payment_method_check
      check (preferred_payment_method in ('GCash', 'Maya', 'Counter'));
  end if;
end;
$$;

grant update (address_line, barangay, city, province, postal_code, country, preferred_payment_method)
  on public.profiles to authenticated;
