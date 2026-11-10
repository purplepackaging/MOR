-- MOR Supply: client portal, phase 1 (ordering).
--
-- Customers sign in with an email code (Supabase Auth, no self sign-up). Each
-- signed-in user belongs to one or more accounts. Row level security limits
-- every read to the user's own accounts. Writes go through the functions at
-- the bottom, which check membership and compute prices on the server.
--
-- Prices: price per case = cost per case x (1 + tier markup), rounded to cents.
-- An account with no tier sees no prices. Costs and markups are never
-- readable by customers.
--
-- You manage accounts, tiers, costs and order status in the Supabase dashboard
-- (Table Editor). The dashboard uses the service role, which bypasses RLS.
--
-- Run after 20261109000000_init.sql: SQL Editor -> paste -> Run.

-- Price tiers by expected volume. Markup is on cost: 0.20 means cost x 1.20.
create table if not exists public.price_tiers (
  code    text primary key check (code ~ '^[A-Z]{1,4}$'),
  markup  numeric(5,4) not null check (markup >= 0 and markup < 5),
  sort    smallint not null unique
);

insert into public.price_tiers (code, markup, sort) values
  ('XL', 0.20, 1),
  ('L',  0.25, 2),
  ('M',  0.30, 3),
  ('S',  0.35, 4),
  ('XS', 0.40, 5)
on conflict (code) do nothing;

-- Customer businesses. Set tier when you are ready for them to see prices.
create table if not exists public.accounts (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  name                text not null check (char_length(name) between 1 and 120),
  tier                text references public.price_tiers (code),
  active              boolean not null default true,
  delivery_day        text check (delivery_day is null or delivery_day in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat')),
  phone               text check (phone is null or phone ~ '^\+1[2-9][0-9]{9}$'),
  email               text check (email is null or char_length(email) <= 160),
  street              text check (street is null or char_length(street) <= 160),
  city                text check (city is null or char_length(city) <= 80),
  zip                 text check (zip is null or zip ~ '^[0-9]{5}$'),
  preferred_language  text not null default 'en' check (preferred_language in ('en', 'es', 'tr', 'ar')),
  rep_code            text check (rep_code is null or rep_code ~ '^[A-Z0-9]{1,12}$'),
  request_id          uuid references public.account_requests (id) on delete set null,
  notes               text check (notes is null or char_length(notes) <= 2000)
);

-- Who can sign in for which account. user_id comes from Authentication -> Users.
create table if not exists public.account_users (
  account_id  uuid not null references public.accounts (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'buyer' check (role in ('owner', 'buyer')),
  created_at  timestamptz not null default now(),
  primary key (account_id, user_id)
);

create index if not exists account_users_user_idx on public.account_users (user_id);

-- Your landed cost per case, by MOR SKU. Load it from the cost sheet with
-- public.load_costs (below), or edit single rows in the Table Editor.
create table if not exists public.product_costs (
  sku            text primary key check (sku ~ '^[A-Z0-9][A-Z0-9-]{0,23}$'),
  cost_per_case  numeric(10,2) not null check (cost_per_case > 0),
  updated_at     timestamptz not null default now()
);

create table if not exists public.orders (
  id           uuid primary key default gen_random_uuid(),
  number       bigint generated always as identity (start with 1001) unique,
  account_id   uuid not null references public.accounts (id) on delete restrict,
  placed_by    uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  status       text not null default 'received'
               check (status in ('received', 'confirmed', 'out_for_delivery', 'delivered', 'canceled')),
  note         text check (note is null or char_length(note) <= 500),
  -- Prices are copied at the time of the order. Null when the account had no tier.
  subtotal     numeric(12,2),
  site_locale  text not null default 'en' check (site_locale in ('en', 'es', 'tr', 'ar'))
);

create index if not exists orders_account_created_idx on public.orders (account_id, created_at desc);
create index if not exists orders_status_idx on public.orders (status);

create table if not exists public.order_lines (
  order_id        uuid not null references public.orders (id) on delete cascade,
  sku             text not null,
  cases           integer not null check (cases between 1 and 999),
  price_per_case  numeric(10,2),
  primary key (order_id, sku)
);

-- One saved usual order per account: [{ "sku": "CUP-PET-16", "cases": 4 }]
create table if not exists public.usual_orders (
  account_id  uuid primary key references public.accounts (id) on delete cascade,
  lines       jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Accounts the signed-in user belongs to. Used by the policies below.
create or replace function public.my_account_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select au.account_id
  from public.account_users au
  join public.accounts a on a.id = au.account_id
  where au.user_id = auth.uid() and a.active
$$;

-- The caller's price for every SKU that has a cost, or no rows when the
-- account has no tier yet.
create or replace function public.my_prices(p_account uuid)
returns table (sku text, price_per_case numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select c.sku, round(c.cost_per_case * (1 + t.markup), 2)
  from public.accounts a
  join public.price_tiers t on t.code = a.tier
  cross join public.product_costs c
  where a.id = p_account
    and p_account in (select public.my_account_ids())
$$;

-- Places an order for one of the caller's accounts. Lines: [{ "sku", "cases" }].
-- Unknown or malformed lines are skipped; duplicate SKUs keep the first line.
create or replace function public.place_order(
  p_account uuid,
  p_lines jsonb,
  p_note text default null,
  p_locale text default 'en'
)
returns table (order_id uuid, order_number bigint, order_subtotal numeric)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order   uuid;
  v_number  bigint;
  v_markup  numeric;
  v_count   integer;
  v_total   numeric;
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

  select t.markup into v_markup
  from public.accounts a
  join public.price_tiers t on t.code = a.tier
  where a.id = p_account;

  insert into public.orders (account_id, placed_by, note, site_locale)
  values (
    p_account,
    auth.uid(),
    nullif(left(btrim(coalesce(p_note, '')), 500), ''),
    case when p_locale in ('en', 'es', 'tr', 'ar') then p_locale else 'en' end
  )
  returning id, number into v_order, v_number;

  insert into public.order_lines (order_id, sku, cases, price_per_case)
  select v_order, l.sku, l.cases,
         case when v_markup is null or c.cost_per_case is null then null
              else round(c.cost_per_case * (1 + v_markup), 2) end
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
  into v_total
  from public.order_lines ol
  where ol.order_id = v_order;

  update public.orders set subtotal = v_total where id = v_order;

  return query select v_order, v_number, v_total;
end
$$;

-- Saves the caller's list as the account's usual order (replaces the old one).
create or replace function public.save_usual_order(p_account uuid, p_lines jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_lines jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_account is null or p_account not in (select public.my_account_ids()) then
    raise exception 'not a member of this account' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 150 then
    raise exception 'a usual order has up to 150 lines' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('sku', l.sku, 'cases', l.cases) order by l.n), '[]'::jsonb)
  into v_lines
  from (
    select distinct on (e ->> 'sku') e ->> 'sku' as sku, (e ->> 'cases')::integer as cases, n
    from jsonb_array_elements(p_lines) with ordinality as x(e, n)
    where jsonb_typeof(e) = 'object'
      and (e ->> 'sku') ~ '^[A-Z0-9][A-Z0-9-]{0,23}$'
      and (e ->> 'cases') ~ '^[0-9]{1,3}$'
    order by e ->> 'sku', n
  ) l
  where l.cases between 1 and 999;

  insert into public.usual_orders (account_id, lines, updated_at, updated_by)
  values (p_account, v_lines, now(), auth.uid())
  on conflict (account_id) do update
    set lines = excluded.lines, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

  return jsonb_array_length(v_lines);
end
$$;

-- Loads costs copied from the cost sheet. Select the SKU and Cost per case
-- columns (or whole rows that start with them), copy, and run in the SQL Editor:
--
--   select * from public.load_costs($sheet$
--   (paste here)
--   $sheet$);
--
-- Rows with a blank cost are skipped, so you can fill the sheet a bit at a time
-- and load it again. Costs already loaded are updated. Amounts it cannot read
-- (like 40,00) are listed under check_these and left unchanged. Customers
-- cannot run it.
create or replace function public.load_costs(p_sheet text)
returns table (saved integer, skipped integer, check_these text[])
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_line    text;
  v_fields  text[];
  v_sku     text;
  v_text    text;
  v_cost    numeric;
  v_saved   integer := 0;
  v_skipped integer := 0;
  v_check   text[] := '{}';
begin
  foreach v_line in array regexp_split_to_array(coalesce(p_sheet, ''), '\r?\n') loop
    continue when btrim(v_line, E' \t\r') = '';
    -- Spreadsheets copy columns separated by tabs. Fall back to spaces.
    if position(E'\t' in v_line) > 0 then
      v_fields := string_to_array(v_line, E'\t');
    else
      v_fields := regexp_split_to_array(btrim(v_line), '\s+');
    end if;
    v_sku  := upper(btrim(coalesce(v_fields[1], ''), E' \t\r'));
    v_text := btrim(coalesce(v_fields[2], ''), E' \t\r');

    -- A heading, a note, or no cost yet: skip it.
    if v_sku !~ '^[A-Z0-9][A-Z0-9-]{0,23}$' or v_sku = 'SKU' or v_text in ('', '-', '$-', '$ -') then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Dollars and cents, US style: 40, 40.5, $1,234.50.
    if v_text !~ '^\$?\s*([0-9]{1,3}(,[0-9]{3})+|[0-9]+)(\.[0-9]{1,4})?$' then
      v_check := v_check || (v_sku || ': ' || left(v_text, 40));
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_cost := round(regexp_replace(v_text, '[\s$,]', '', 'g')::numeric, 2);
    if v_cost <= 0 or v_cost >= 100000000 then
      if v_cost > 0 then
        v_check := v_check || (v_sku || ': ' || left(v_text, 40));
      end if;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.product_costs (sku, cost_per_case, updated_at)
    values (v_sku, v_cost, now())
    on conflict (sku) do update
      set cost_per_case = excluded.cost_per_case, updated_at = excluded.updated_at;
    v_saved := v_saved + 1;
  end loop;
  return query select v_saved, v_skipped, v_check;
end
$$;

-- Lets a person sign in and order for a business. Add the person first under
-- Authentication > Users, then run in the SQL Editor:
--
--   select * from public.link_customer('owner@example.com', 'Kebab House');
--
-- Creates the account if no account has that name yet. Add 'buyer' as a third
-- value for staff who order but do not own the account.
create or replace function public.link_customer(p_email text, p_account text, p_role text default 'owner')
returns table (account_id uuid, account_name text, email text, role text, tier text)
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
    select a.id, a.name, u.email::text, au.role, a.tier
    from public.accounts a
    join public.account_users au on au.account_id = a.id and au.user_id = v_user
    join auth.users u on u.id = v_user
    where a.id = v_account;
end
$$;

-- ---------------------------------------------------------------------------
-- Row level security and privileges
-- ---------------------------------------------------------------------------

alter table public.price_tiers   enable row level security;
alter table public.accounts      enable row level security;
alter table public.account_users enable row level security;
alter table public.product_costs enable row level security;
alter table public.orders        enable row level security;
alter table public.order_lines   enable row level security;
alter table public.usual_orders  enable row level security;

-- Start from nothing, then grant only what the portal reads.
revoke all on public.price_tiers, public.accounts, public.account_users, public.product_costs,
  public.orders, public.order_lines, public.usual_orders from anon, authenticated;

-- Tier, notes and contact details stay private to you.
grant select (id, name, delivery_day, created_at) on public.accounts to authenticated;
drop policy if exists "members read their accounts" on public.accounts;
create policy "members read their accounts" on public.accounts
  for select to authenticated
  using (id in (select public.my_account_ids()));

grant select (account_id, user_id, role) on public.account_users to authenticated;
drop policy if exists "users read their memberships" on public.account_users;
create policy "users read their memberships" on public.account_users
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select (id, number, account_id, created_at, status, note, subtotal) on public.orders to authenticated;
drop policy if exists "members read their orders" on public.orders;
create policy "members read their orders" on public.orders
  for select to authenticated
  using (account_id in (select public.my_account_ids()));

grant select on public.order_lines to authenticated;
drop policy if exists "members read their order lines" on public.order_lines;
create policy "members read their order lines" on public.order_lines
  for select to authenticated
  using (order_id in (select o.id from public.orders o where o.account_id in (select public.my_account_ids())));

grant select (account_id, lines, updated_at) on public.usual_orders to authenticated;
drop policy if exists "members read their usual order" on public.usual_orders;
create policy "members read their usual order" on public.usual_orders
  for select to authenticated
  using (account_id in (select public.my_account_ids()));

-- Price tiers and costs have no policies: customers can never read them.

-- Functions run with the owner's rights, so only signed-in users may call them.
revoke all on function public.my_account_ids() from public, anon;
revoke all on function public.my_prices(uuid) from public, anon;
revoke all on function public.place_order(uuid, jsonb, text, text) from public, anon;
revoke all on function public.save_usual_order(uuid, jsonb) from public, anon;
grant execute on function public.my_account_ids() to authenticated;
grant execute on function public.my_prices(uuid) to authenticated;
grant execute on function public.place_order(uuid, jsonb, text, text) to authenticated;
grant execute on function public.save_usual_order(uuid, jsonb) to authenticated;

-- Loading costs and linking customers are for you only, from the dashboard.
revoke all on function public.load_costs(text) from public, anon, authenticated;
revoke all on function public.link_customer(text, text, text) from public, anon, authenticated;
