-- Supabase no longer gives the API roles (anon, authenticated, service_role)
-- access to new tables automatically (enforced on all projects Oct 30, 2026).
--
-- The request-an-account form writes through the Data API with the secret key
-- (service_role), so it needs this grant. Row level security stays on, and
-- service_role bypasses it. The portal tables grant their own access in
-- 20261110000000_portal.sql.

grant insert on public.account_requests to service_role;
