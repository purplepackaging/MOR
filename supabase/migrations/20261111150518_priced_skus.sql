-- MOR Supply: which SKUs have a cost.
--
-- The site shows only items that have a price, so its server needs to know which
-- SKUs have a cost. This function returns the SKUs and nothing else: no cost and
-- no margin leave the database through it. Only the site's server key may call it.
--
-- One call returns every SKU as a single array, so the Data API's row limit can
-- never cut the list short.

-- The function runs with the caller's rights, so the server role must be able to
-- read the sku column. (It already can on projects where service_role gets every
-- table by default.)
grant select (sku) on public.product_costs to service_role;

create or replace function public.priced_skus()
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(c.sku order by c.sku), '{}'::text[])
  from public.product_costs c
$$;

-- Customers and signed-out visitors can never call it.
revoke all on function public.priced_skus() from public, anon, authenticated;
grant execute on function public.priced_skus() to service_role;
