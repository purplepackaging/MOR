-- MOR Supply: paying for an order online with Stripe, from the order's pay link.
--
-- Every order has a pay link: https://morsupply.com/pay/<pay_token> (or /es/pay/..., /tr/..., /ar/...).
-- Whoever holds the link sees what the order holds and comes to, and pays it by bank (ACH) or by card.
-- A credit card adds the fee set in src/config/site.ts (2.9%); bank payments and debit cards add nothing.
-- The site's server reads the order behind a link and records what Stripe says about its payment, both
-- through the two functions below, which only the server key may call. Customers read the payment
-- columns of their own orders. Nothing here drops or rewrites existing data.
--
-- In the Table Editor (orders):
--   pay_token              the end of the order's pay link. Never edit it: links already sent stop working.
--   payment_status         unpaid; processing (a bank payment on its way, about 4 business days); paid;
--                          failed (the last payment did not go through, and the link still works)
--   payment_method         bank, credit_card, debit_card or card (a card that is neither, such as prepaid)
--   card_fee               the credit card fee charged on top of the order (0 otherwise)
--   payment_amount         what the payment comes to: the order plus any card fee
--   paid_at                when Stripe said the money is in
--   payment_updated_at     the last time the payment changed
--   stripe_payment_intent  the payment in Stripe: paste it into the Dashboard's search

-- Each column carries its own checks, so running this again skips them with the column.
alter table public.orders
  add column if not exists pay_token              uuid not null default gen_random_uuid() unique,
  add column if not exists payment_status         text not null default 'unpaid'
    check (payment_status in ('unpaid', 'processing', 'paid', 'failed')),
  add column if not exists payment_method         text
    check (payment_method is null or payment_method in ('bank', 'credit_card', 'debit_card', 'card')),
  add column if not exists card_fee               numeric(12,2) check (card_fee is null or card_fee >= 0),
  add column if not exists payment_amount         numeric(12,2) check (payment_amount is null or payment_amount > 0),
  add column if not exists paid_at                timestamptz,
  add column if not exists payment_updated_at     timestamptz,
  add column if not exists stripe_payment_intent  text
    check (stripe_payment_intent is null or stripe_payment_intent ~ '^pi_[A-Za-z0-9_]+$');

-- Members see whether their orders are paid, and the link to pay them. Row level security
-- ("members read their orders") already limits the rows to their own. The Stripe id stays with you.
grant select (pay_token, payment_status, payment_method, card_fee, payment_amount, paid_at, payment_updated_at)
  on public.orders to authenticated;

-- The order behind a pay link, for the pay page. Unknown links find nothing.
-- amount_due is what the order comes to; orders placed before delivery fees existed have no
-- total, so their subtotal is what they come to (as on the account pages).
create or replace function public.order_for_pay(p_token uuid)
returns table (
  order_id            uuid,
  order_number        bigint,
  account_name        text,
  created_at          timestamptz,
  status              text,
  subtotal            numeric,
  delivery_fee        numeric,
  next_day            boolean,
  next_day_fee        numeric,
  amount_due          numeric,
  site_locale         text,
  lines               jsonb,
  payment_status      text,
  payment_method      text,
  card_fee            numeric,
  payment_amount      numeric,
  paid_at             timestamptz,
  payment_updated_at  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.number, a.name, o.created_at, o.status, o.subtotal, o.delivery_fee, o.next_day, o.next_day_fee,
         case when o.delivery_fee is null then o.subtotal else o.total end,
         o.site_locale,
         coalesce(
           (select jsonb_agg(jsonb_build_object('sku', l.sku, 'cases', l.cases, 'price', l.price_per_case) order by l.sku)
            from public.order_lines l
            where l.order_id = o.id),
           '[]'::jsonb),
         o.payment_status, o.payment_method, o.card_fee, o.payment_amount, o.paid_at, o.payment_updated_at
  from public.orders o
  join public.accounts a on a.id = o.account_id
  where o.pay_token = p_token
$$;

-- Records what Stripe says about a payment for an order: from the pay page right after paying, and
-- from Stripe's webhook, which can send the same news twice or out of order.
--   p_status   'processing' (a bank payment on its way), 'paid' or 'failed'
--   p_intent   the Stripe payment (pi_...)
--   p_method   bank, credit_card, debit_card or card (not needed for 'failed')
-- Answers one row, with what the team's email needs: the order's number, business, pay token,
-- language and status. result is
--   changed   the order's payment changed
--   same      nothing new
--   ignored   news about another attempt: a declined card the customer replaced, or a payment that
--             failed after another one came in
--   twice     a second payment for an order that already had one: refund one of them in Stripe.
--             A payment that completes while a bank payment is still on its way becomes the order's
--             payment; otherwise the first one stays.
-- An unknown order answers no row.
create or replace function public.set_order_payment(
  p_order     uuid,
  p_status    text,
  p_intent    text,
  p_method    text default null,
  p_card_fee  numeric default 0,
  p_amount    numeric default null
)
returns table (result text, order_number bigint, account_name text, pay_token uuid, site_locale text, order_status text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status  text;
  v_intent  text;
  v_result  text;
begin
  if p_status is null or p_status not in ('processing', 'paid', 'failed') then
    raise exception 'payment status must be processing, paid or failed' using errcode = '22023';
  end if;
  if p_intent is null or p_intent !~ '^pi_[A-Za-z0-9_]+$' then
    raise exception 'a Stripe payment id (pi_...) is required' using errcode = '22023';
  end if;
  if p_status <> 'failed' and (
       p_method is null or p_method not in ('bank', 'credit_card', 'debit_card', 'card')
       or p_amount is null or p_amount <= 0 or coalesce(p_card_fee, 0) < 0) then
    raise exception 'a payment needs its method, an amount and a fee of 0 or more' using errcode = '22023';
  end if;

  -- One payment change at a time per order.
  select o.payment_status, o.stripe_payment_intent into v_status, v_intent
  from public.orders o
  where o.id = p_order
  for update;
  if not found then
    return;
  end if;

  if p_status = 'failed' then
    if v_intent is distinct from p_intent or v_status = 'paid' then
      v_result := 'ignored';
    elsif v_status = 'failed' then
      v_result := 'same';
    else
      update public.orders o
      set payment_status = 'failed', payment_updated_at = now()
      where o.id = p_order;
      v_result := 'changed';
    end if;
  elsif v_intent = p_intent and (v_status = p_status or (v_status = 'paid' and p_status = 'processing')) then
    -- The same news again, or "on its way" arriving after "paid".
    v_result := 'same';
  elsif v_status = 'paid' or (v_status = 'processing' and p_status = 'processing') then
    v_result := 'twice';
  else
    update public.orders o
    set payment_status = p_status,
        stripe_payment_intent = p_intent,
        payment_method = p_method,
        card_fee = coalesce(p_card_fee, 0),
        payment_amount = p_amount,
        paid_at = case when p_status = 'paid' then now() end,
        payment_updated_at = now()
    where o.id = p_order;
    v_result := case when v_status = 'processing' and v_intent is distinct from p_intent then 'twice' else 'changed' end;
  end if;

  return query
    select v_result, o.number, a.name, o.pay_token, o.site_locale, o.status
    from public.orders o
    join public.accounts a on a.id = o.account_id
    where o.id = p_order;
end
$$;

-- Customers and signed-out visitors can never call either: only the site's server key.
revoke all on function public.order_for_pay(uuid) from public, anon, authenticated;
revoke all on function public.set_order_payment(uuid, text, text, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.order_for_pay(uuid) to service_role;
grant execute on function public.set_order_payment(uuid, text, text, text, numeric, numeric) to service_role;

-- Canceling (from 20261111191720_self_service.sql), now also refused once an order is paid or a bank
-- payment for it is on its way: that needs a refund, which the team makes. Answers 'canceled',
-- 'too_late' (confirmed already), 'paid' or 'not_found'. Canceling an order that is already canceled
-- answers 'canceled' again and changes nothing.
create or replace function public.cancel_my_order(p_account uuid, p_number bigint)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_status   text;
  v_payment  text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_account is null or p_account not in (select public.my_account_ids()) then
    raise exception 'not a member of this account' using errcode = '42501';
  end if;

  -- One statement decides it, so an order you confirm, or one paid, at the same moment is never canceled under you.
  update public.orders o
  set status = 'canceled', canceled_at = now(), canceled_by = v_user
  where o.account_id = p_account and o.number = p_number and o.status = 'received'
    and o.payment_status not in ('processing', 'paid')
  returning o.status into v_status;
  if v_status is not null then
    return 'canceled';
  end if;

  select o.status, o.payment_status into v_status, v_payment
  from public.orders o
  where o.account_id = p_account and o.number = p_number;
  if v_status is null then
    return 'not_found';
  end if;
  if v_status = 'canceled' then
    return 'canceled';
  end if;
  return case when v_payment in ('processing', 'paid') then 'paid' else 'too_late' end;
end
$$;

revoke all on function public.cancel_my_order(uuid, bigint) from public, anon;
grant execute on function public.cancel_my_order(uuid, bigint) to authenticated;
