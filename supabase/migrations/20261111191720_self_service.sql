-- Self-service for customers: correct the business details and cancel an
-- order that has not been confirmed yet. Both go through functions that check
-- who is asking. Nothing here drops or rewrites existing data.
--
-- In the Table Editor:
--   orders.canceled_at / canceled_by   set when the customer cancels on the site.
--                                      Empty on orders you cancel yourself.
--   accounts.details_updated_at        the last time the customer changed their details.

alter table public.orders
  add column if not exists canceled_at  timestamptz,
  add column if not exists canceled_by  uuid references auth.users (id) on delete set null;

alter table public.accounts
  add column if not exists details_updated_at  timestamptz;

-- Members read the details of their own business. Row level security
-- ("members read their accounts") already limits the rows to their own.
grant select (contact_name, phone, street, city, zip, preferred_language) on public.accounts to authenticated;
grant select (canceled_at) on public.orders to authenticated;

-- The owner of a business corrects its name, contact, phone, address and
-- language. Staff added as buyers cannot. Lengths and formats are held by the
-- checks on the table: phone +1XXXXXXXXXX, 5-digit ZIP.
create or replace function public.update_my_account(
  p_account uuid,
  p_name text,
  p_contact_name text,
  p_phone text,
  p_street text,
  p_city text,
  p_zip text,
  p_language text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_account is null or not exists (
    select 1
    from public.account_users au
    join public.accounts a on a.id = au.account_id
    where au.account_id = p_account and au.user_id = v_user and au.role = 'owner' and a.active
  ) then
    raise exception 'only the owner of an active account can change its details' using errcode = '42501';
  end if;
  if btrim(coalesce(p_name, '')) = '' or btrim(coalesce(p_contact_name, '')) = ''
     or btrim(coalesce(p_street, '')) = '' or btrim(coalesce(p_city, '')) = ''
     or p_phone is null or p_zip is null then
    raise exception 'business name, contact name, phone and address are required' using errcode = '22023';
  end if;

  update public.accounts a
  set name = btrim(p_name),
      contact_name = btrim(p_contact_name),
      phone = p_phone,
      street = btrim(p_street),
      city = btrim(p_city),
      zip = p_zip,
      preferred_language = case when p_language in ('en', 'es', 'tr', 'ar') then p_language else a.preferred_language end,
      details_updated_at = now()
  where a.id = p_account;
end
$$;

-- A customer cancels an order while it is still "received". Once you confirm
-- it, the answer is 'too_late' and nothing changes. Returns 'canceled',
-- 'too_late' or 'not_found'. Canceling an order that is already canceled
-- answers 'canceled' again and changes nothing.
create or replace function public.cancel_my_order(p_account uuid, p_number bigint)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_status  text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_account is null or p_account not in (select public.my_account_ids()) then
    raise exception 'not a member of this account' using errcode = '42501';
  end if;

  -- One statement decides it, so an order you confirm at the same moment is never canceled under you.
  update public.orders o
  set status = 'canceled', canceled_at = now(), canceled_by = v_user
  where o.account_id = p_account and o.number = p_number and o.status = 'received'
  returning o.status into v_status;
  if v_status is not null then
    return 'canceled';
  end if;

  select o.status into v_status
  from public.orders o
  where o.account_id = p_account and o.number = p_number;
  if v_status is null then
    return 'not_found';
  end if;
  return case when v_status = 'canceled' then 'canceled' else 'too_late' end;
end
$$;

revoke all on function public.update_my_account(uuid, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.cancel_my_order(uuid, bigint) from public, anon;
grant execute on function public.update_my_account(uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.cancel_my_order(uuid, bigint) to authenticated;
