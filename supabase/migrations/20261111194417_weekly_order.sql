-- The weekly order, part 1: a customer says they want their usual order every
-- week, and can skip one delivery. Nothing is placed automatically by this
-- migration. The switch pricing.weekly_orders_on stays off until reminders by
-- email and the delivery days are in place; until then the site only records
-- who asked. Nothing here drops or rewrites existing data.
--
-- In the Table Editor:
--   usual_orders.weekly        true once the customer asks for a weekly order.
--   usual_orders.weekly_since  when they asked.
--   usual_orders.skip_date     one delivery date they want left out.
--   pricing.weekly_orders_on   the switch for the whole site. Leave it off for now.
--   accounts.delivery_day      set this for each customer who asks (mon to sat).

alter table public.usual_orders
  add column if not exists weekly        boolean not null default false,
  add column if not exists weekly_since  timestamptz,
  add column if not exists skip_date     date;

alter table public.pricing
  add column if not exists weekly_orders_on  boolean not null default false;

-- Members read their own usual order (row level security limits the rows).
grant select (weekly, weekly_since, skip_date) on public.usual_orders to authenticated;

-- The next delivery date for a delivery day, and when its order closes:
-- 5 pm Eastern, two days before. Plain date arithmetic; it reads no table.
create or replace function public.next_delivery(p_day text, p_now timestamptz default now())
returns table (delivery_date date, closes_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.day, ((d.day - 2) + time '17:00') at time zone 'America/New_York'
  from (
    select (p_now at time zone 'America/New_York')::date + n as day
    from generate_series(0, 9) as n
  ) d
  where extract(isodow from d.day) = array_position(array['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], p_day)
    and ((d.day - 2) + time '17:00') at time zone 'America/New_York' > p_now
  order by d.day
  limit 1
$$;

-- Whether weekly orders are switched on for the site. Customers cannot read
-- public.pricing, so this tells them the one thing they need from it.
create or replace function public.weekly_orders_live()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.weekly_orders_on from public.pricing p), false)
$$;

-- A member turns the weekly order on or off. It needs a saved usual order
-- with at least one line. Turning it off also forgets a skipped date.
create or replace function public.set_weekly_order(p_account uuid, p_on boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_lines integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_account is null or p_account not in (select public.my_account_ids()) then
    raise exception 'not a member of this account' using errcode = '42501';
  end if;

  if coalesce(p_on, false) then
    select jsonb_array_length(u.lines) into v_lines
    from public.usual_orders u
    where u.account_id = p_account;
    if coalesce(v_lines, 0) = 0 then
      raise exception 'save a usual order first' using errcode = '22023';
    end if;
    update public.usual_orders u
    set weekly = true,
        weekly_since = case when u.weekly then u.weekly_since else now() end
    where u.account_id = p_account;
  else
    update public.usual_orders u
    set weekly = false, weekly_since = null, skip_date = null
    where u.account_id = p_account;
  end if;
end
$$;

-- A member skips the next delivery of the weekly order, or takes the skip
-- back. Only the coming delivery can be skipped, and only before its order
-- closes. Returns the delivery date it applies to.
create or replace function public.skip_weekly_order(p_account uuid, p_skip boolean)
returns date
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_day   text;
  v_date  date;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_account is null or p_account not in (select public.my_account_ids()) then
    raise exception 'not a member of this account' using errcode = '42501';
  end if;

  select a.delivery_day into v_day from public.accounts a where a.id = p_account;
  select n.delivery_date into v_date from public.next_delivery(v_day) n;
  if v_date is null then
    raise exception 'this account has no delivery day yet' using errcode = '22023';
  end if;

  update public.usual_orders u
  set skip_date = case when coalesce(p_skip, false) then v_date else null end
  where u.account_id = p_account and u.weekly;
  if not found then
    raise exception 'the weekly order is off' using errcode = '22023';
  end if;
  return v_date;
end
$$;

revoke all on function public.next_delivery(text, timestamptz) from public, anon;
revoke all on function public.weekly_orders_live() from public, anon;
revoke all on function public.set_weekly_order(uuid, boolean) from public, anon;
revoke all on function public.skip_weekly_order(uuid, boolean) from public, anon;
grant execute on function public.next_delivery(text, timestamptz) to authenticated;
grant execute on function public.weekly_orders_live() to authenticated;
grant execute on function public.set_weekly_order(uuid, boolean) to authenticated;
grant execute on function public.skip_weekly_order(uuid, boolean) to authenticated;
