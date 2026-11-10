-- MOR Supply: open sign-up, one margin for everyone, delivery fees.
--
-- Anyone can create an account. They sign in with an email code (Supabase Auth
-- sign-ups are on), then public.create_my_account sets up their business and
-- makes them its owner. New accounts see prices and can order right away. You
-- confirm each order before it ships, and you can switch an account off
-- (accounts.active) at any time.
--
-- Prices: price per case = cost per case / (1 - margin), rounded to cents. With
-- the margin at 0.25, a $10.00 case sells for $13.33. The size-based tiers are
-- gone. Every order also carries a delivery fee, plus a next-day fee when the
-- customer asks for next-day delivery. The margin and both fees are the single
-- row in public.pricing, which you edit in the Table Editor. Orders copy prices
-- and fees when they are placed, so later changes never touch old orders.
--
-- Customers can read the fees (they see them before ordering) but never the
-- margin or costs. Card fees are not part of the order: the site says credit
-- cards add a surcharge, and the card processor charges it at payment.
--
-- It drops the old tiers and replaces two functions, so Supabase asks you to
-- confirm it in the SQL Editor.

-- ---------------------------------------------------------------------------
-- Pricing settings: one row
-- ---------------------------------------------------------------------------

create table if not exists public.pricing (
  id            boolean primary key default true check (id),
  -- Share of the selling price you keep. 0.25 means price = cost / 0.75.
  margin        numeric(5,4) not null default 0.25 check (margin >= 0 and margin < 0.9),
  delivery_fee  numeric(10,2) not null default 50 check (delivery_fee >= 0),
  next_day_fee  numeric(10,2) not null default 50 check (next_day_fee >= 0)
);

insert into public.pricing (id) values (true) on conflict (id) do nothing;

alter table public.pricing enable row level security;
-- No policies and no grants: only you (dashboard) and the functions below read it.
revoke all on public.pricing from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Accounts people create themselves
-- ---------------------------------------------------------------------------

alter table public.accounts
  add column if not exists contact_name     text check (contact_name is null or char_length(contact_name) between 1 and 80),
  add column if not exists business_type    text
                           check (business_type is null or business_type in ('restaurant', 'cafe', 'caterer', 'hotel', 'foodTruck', 'market', 'other')),
  -- Text message consent record (10DLC): what they agreed to, and when.
  add column if not exists sms_consent      boolean not null default false,
  add column if not exists sms_consent_text text,
  add column if not exists sms_consent_at   timestamptz,
  -- The person who created the account on the website. Null for accounts you set up.
  add column if not exists created_by       uuid references auth.users (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounts_sms_consent_recorded') then
    alter table public.accounts add constraint accounts_sms_consent_recorded
      check (not sms_consent or (sms_consent_text is not null and sms_consent_at is not null));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Fees on orders
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists next_day      boolean not null default false,
  add column if not exists delivery_fee  numeric(10,2),
  add column if not exists next_day_fee  numeric(10,2),
  -- subtotal + fees. Null while any line has no price.
  add column if not exists total         numeric(12,2);

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- The caller's price for every SKU that has a cost.
create or replace function public.my_prices(p_account uuid)
returns table (sku text, price_per_case numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select c.sku, round(c.cost_per_case / (1 - p.margin), 2)
  from public.product_costs c
  cross join public.pricing p
  where p_account in (select public.my_account_ids())
$$;

-- Delivery fees, shown before a customer places an order.
create or replace function public.order_fees()
returns table (delivery_fee numeric, next_day_fee numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select p.delivery_fee, p.next_day_fee
  from public.pricing p
  where auth.uid() is not null
$$;

-- Places an order for one of the caller's accounts. Lines: [{ "sku", "cases" }].
-- Unknown or malformed lines are skipped; duplicate SKUs keep the first line.
drop function if exists public.place_order(uuid, jsonb, text, text);
create or replace function public.place_order(
  p_account uuid,
  p_lines jsonb,
  p_note text default null,
  p_locale text default 'en',
  p_next_day boolean default false
)
returns table (order_id uuid, order_number bigint, order_subtotal numeric, order_total numeric)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order     uuid;
  v_number    bigint;
  v_margin    numeric;
  v_delivery  numeric;
  v_next_fee  numeric;
  v_next_day  boolean := coalesce(p_next_day, false);
  v_count     integer;
  v_subtotal  numeric;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_account is null or p_account not in (select public.my_account_ids()) then
    raise exception 'not a member of this account' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 150 then
    raise exception 'an order needs 1 to 150 lines' using errcode = '22023';
  end if;

  select p.margin, p.delivery_fee, case when v_next_day then p.next_day_fee else 0 end
  into v_margin, v_delivery, v_next_fee
  from public.pricing p;
  if not found then
    raise exception 'pricing is not set up' using errcode = '55000';
  end if;

  insert into public.orders (account_id, placed_by, note, site_locale, next_day, delivery_fee, next_day_fee)
  values (
    p_account,
    auth.uid(),
    nullif(left(btrim(coalesce(p_note, '')), 500), ''),
    case when p_locale in ('en', 'es', 'tr', 'ar') then p_locale else 'en' end,
    v_next_day,
    v_delivery,
    v_next_fee
  )
  returning id, number into v_order, v_number;

  insert into public.order_lines (order_id, sku, cases, price_per_case)
  select v_order, l.sku, l.cases,
         case when c.cost_per_case is null then null
              else round(c.cost_per_case / (1 - v_margin), 2) end
  from (
    select distinct on (e ->> 'sku') e ->> 'sku' as sku, (e ->> 'cases')::integer as cases
    from jsonb_array_elements(p_lines) with ordinality as x(e, n)
    where jsonb_typeof(e) = 'object'
      and (e ->> 'sku') ~ '^[A-Z0-9][A-Z0-9-]{0,23}$'
      and (e ->> 'cases') ~ '^[0-9]{1,3}$'
    order by e ->> 'sku', n
  ) l
  left join public.product_costs c on c.sku = l.sku
  where l.cases between 1 and 999;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'no valid lines' using errcode = '22023';
  end if;

  -- A subtotal only when every line has a price.
  select case when bool_or(ol.price_per_case is null) then null
              else sum(ol.price_per_case * ol.cases) end
  into v_subtotal
  from public.order_lines ol
  where ol.order_id = v_order;

  update public.orders
  set subtotal = v_subtotal, total = v_subtotal + v_delivery + v_next_fee
  where id = v_order;

  return query select v_order, v_number, v_subtotal, v_subtotal + v_delivery + v_next_fee;
end
$$;

-- Sets up the signed-in person's business and makes them its owner. One business
-- per sign-up; you add people who order for more than one with link_customer.
create or replace function public.create_my_account(
  p_name text,
  p_contact_name text,
  p_phone text,
  p_street text,
  p_city text,
  p_zip text,
  p_language text default 'en',
  p_business_type text default null,
  p_rep_code text default null,
  p_sms_consent_text text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_account  uuid;
  v_consent  text := nullif(btrim(coalesce(p_sms_consent_text, '')), '');
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if exists (select 1 from public.account_users au where au.user_id = v_user) then
    raise exception 'already has an account' using errcode = '23505';
  end if;
  if btrim(coalesce(p_name, '')) = '' or btrim(coalesce(p_contact_name, '')) = ''
     or btrim(coalesce(p_street, '')) = '' or btrim(coalesce(p_city, '')) = '' then
    raise exception 'business name, contact name and address are required' using errcode = '22023';
  end if;

  -- Table checks cover lengths and formats: phone +1XXXXXXXXXX, 5-digit ZIP, known business types.
  insert into public.accounts (
    name, contact_name, phone, email, street, city, zip, preferred_language,
    business_type, rep_code, sms_consent, sms_consent_text, sms_consent_at, created_by
  )
  select
    btrim(p_name), btrim(p_contact_name), p_phone, u.email, btrim(p_street), btrim(p_city), p_zip,
    case when p_language in ('en', 'es', 'tr', 'ar') then p_language else 'en' end,
    nullif(p_business_type, ''),
    nullif(left(upper(regexp_replace(coalesce(p_rep_code, ''), '[^A-Za-z0-9]', '', 'g')), 12), ''),
    v_consent is not null, v_consent, case when v_consent is not null then now() end,
    v_user
  from auth.users u
  where u.id = v_user
  returning id into v_account;

  if v_account is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  insert into public.account_users (account_id, user_id, role) values (v_account, v_user, 'owner');
  return v_account;
end
$$;

-- The tiers are replaced by the single margin in public.pricing.
drop function if exists public.link_customer(text, text, text);
alter table public.accounts drop column if exists tier;
drop table if exists public.price_tiers;

-- Adds a person to a business, for example staff who order for an account that
-- already exists. Add the person first under Authentication > Users (or let
-- them sign in once), then run in the SQL Editor:
--
--   select * from public.link_customer('buyer@example.com', 'Kebab House', 'buyer');
--
-- Creates the account if no account has that name yet.
create or replace function public.link_customer(p_email text, p_account text, p_role text default 'owner')
returns table (account_id uuid, account_name text, email text, role text)
language plpgsql
volatile
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user    uuid;
  v_account uuid;
  v_matches integer;
  v_name    text := btrim(coalesce(p_account, ''));
begin
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if v_user is null then
    raise exception 'No user with the email %. Add them under Authentication > Users first.', p_email
      using errcode = 'P0002';
  end if;
  if p_role is null or p_role not in ('owner', 'buyer') then
    raise exception 'Role must be owner or buyer.' using errcode = '22023';
  end if;
  if v_name = '' then
    raise exception 'Give the account a name.' using errcode = '22023';
  end if;

  select count(*) into v_matches from public.accounts a where lower(a.name) = lower(v_name);
  if v_matches > 1 then
    raise exception 'More than one account is named %. Rename one in the Table Editor first.', v_name
      using errcode = '21000';
  elsif v_matches = 1 then
    select a.id into v_account from public.accounts a where lower(a.name) = lower(v_name);
  else
    insert into public.accounts (name) values (v_name) returning id into v_account;
  end if;

  insert into public.account_users as au (account_id, user_id, role)
  values (v_account, v_user, p_role)
  on conflict on constraint account_users_pkey do update set role = excluded.role;

  return query
    select a.id, a.name, u.email::text, au.role
    from public.accounts a
    join public.account_users au on au.account_id = a.id and au.user_id = v_user
    join auth.users u on u.id = v_user
    where a.id = v_account;
end
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

grant select (id, number, account_id, created_at, status, note, subtotal, next_day, delivery_fee, next_day_fee, total)
  on public.orders to authenticated;

revoke all on function public.order_fees() from public, anon;
revoke all on function public.place_order(uuid, jsonb, text, text, boolean) from public, anon;
revoke all on function public.create_my_account(text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.order_fees() to authenticated;
grant execute on function public.place_order(uuid, jsonb, text, text, boolean) to authenticated;
grant execute on function public.create_my_account(text, text, text, text, text, text, text, text, text, text) to authenticated;

revoke all on function public.link_customer(text, text, text) from public, anon, authenticated;
