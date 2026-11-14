-- Delivery: $20 on orders under $200, free from $200 (Matt, Nov 13, 2026). The aim is bigger orders.
-- Delivery was free on every order from Nov 12, and $50 an order from Nov 10.
--
-- The subtotal decides: cases times the price per case, before any fee or card surcharge. An order of
-- exactly $200.00 delivers free. When some lines have no price yet, the priced lines alone decide, so an
-- order is never charged delivery that its known lines already make free.
--
-- public.pricing gets free_delivery_from, the subtotal from which delivery is free. Null means the delivery
-- fee applies to every order, as before. The dashboard can change both numbers; the FAQ and the terms state
-- them from src/config/site.ts, so change them together.
--
-- place_order works the fee out from the subtotal and copies it onto the order, as before, so orders
-- already placed keep the fees they copied. The next-day fee is separate and stays as it is ($0, and the
-- list no longer offers next-day delivery).
--
-- delivery_terms() gives a signed-in customer the fee and the threshold, so the list can show the fee and
-- how much more to add for free delivery. It is a new function because order_fees() cannot gain a column
-- without being dropped first. order_fees() stays for the site version that was live before this one;
-- nothing calls it after that.
--
-- Nothing is dropped, so the Supabase connector can apply it.

alter table public.pricing
  add column if not exists free_delivery_from numeric(10,2)
    check (free_delivery_from is null or free_delivery_from > 0);

update public.pricing set delivery_fee = 20, free_delivery_from = 200 where id;

-- The delivery fee and the subtotal from which delivery is free, shown before a customer orders.
create or replace function public.delivery_terms()
returns table (delivery_fee numeric, free_delivery_from numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select p.delivery_fee, p.free_delivery_from
  from public.pricing p
  where auth.uid() is not null
$$;

revoke all on function public.delivery_terms() from public, anon;
grant execute on function public.delivery_terms() to authenticated;

-- Places an order for one of the caller's accounts. Lines: [{ "sku", "cases" }].
-- Unknown or malformed lines are skipped; duplicate SKUs keep the first line.
-- Same signature and answer as before, so its grants stay; only the delivery fee changes.
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
  v_fee       numeric;
  v_free_from numeric;
  v_delivery  numeric;
  v_next_fee  numeric;
  v_next_day  boolean := coalesce(p_next_day, false);
  v_count     integer;
  v_priced    numeric;
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

  select p.margin, p.delivery_fee, p.free_delivery_from, case when v_next_day then p.next_day_fee else 0 end
  into v_margin, v_fee, v_free_from, v_next_fee
  from public.pricing p;
  if not found then
    raise exception 'pricing is not set up' using errcode = '55000';
  end if;

  -- The order starts with the full delivery fee. Once its lines are in, the subtotal decides the fee,
  -- in this same transaction.
  insert into public.orders (account_id, placed_by, note, site_locale, next_day, delivery_fee, next_day_fee)
  values (
    p_account,
    auth.uid(),
    nullif(left(btrim(coalesce(p_note, '')), 500), ''),
    case when p_locale in ('en', 'es', 'tr', 'ar') then p_locale else 'en' end,
    v_next_day,
    v_fee,
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

  -- What the priced lines come to, and a subtotal only when every line has a price.
  select sum(ol.price_per_case * ol.cases),
         case when bool_or(ol.price_per_case is null) then null
              else sum(ol.price_per_case * ol.cases) end
  into v_priced, v_subtotal
  from public.order_lines ol
  where ol.order_id = v_order;

  -- Free delivery once the products come to the threshold.
  v_delivery := case when v_free_from is not null and coalesce(v_priced, 0) >= v_free_from then 0
                     else v_fee end;

  update public.orders
  set subtotal = v_subtotal, delivery_fee = v_delivery, total = v_subtotal + v_delivery + v_next_fee
  where id = v_order;

  return query select v_order, v_number, v_subtotal, v_subtotal + v_delivery + v_next_fee;
end
$$;
