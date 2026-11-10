# MOR Supply: notes for coding agents

Next.js 16 App Router, React 19, TypeScript, CSS Modules. No UI framework. Deployed on Vercel from `main`.

Commands: `npm run dev`, `npm run typecheck`, `npm run build`.

## Rules

- **Secrets:** never commit or print them. Server code reads `SUPABASE_URL` and `SUPABASE_SECRET_KEY`
  from the environment through `src/lib/supabase.ts` (server-only). The portal also reads
  `SUPABASE_PUBLISHABLE_KEY` (in `src/lib/portal.ts` and `src/proxy.ts`). Nothing secret gets a `NEXT_PUBLIC_` prefix.
- **Four languages:** every visible string lives in `src/i18n/en.ts` and the same key in `es.ts`, `tr.ts`
  and `ar.ts`. `Dict` is typed from English, so a missing key fails the typecheck. Use `plural()` for
  counts (Arabic has six forms) and `formatNumber()` for numbers (Latin digits everywhere).
- **Right to left:** Arabic pages set `dir="rtl"`. Use logical CSS (`inset-inline-start`, `padding-inline`,
  `text-align: start`). Mirror only directional icons.
- **Routing:** `src/proxy.ts` serves English at the root and rewrites to `/en`. Build links with
  `localePath(locale, path)`, never by hand.
- **Catalog:** `src/data/catalog.ts`. SKUs are permanent IDs; never rename one that has been used.
  The build fails on duplicate SKUs or broken `goesWith` links.
- **Copy:** sentence case, short sentences, plain verbs, no em dashes. Prices are never shown publicly
  (only to signed-in customers whose account has a tier).
  Spices and dry goods are planned but not mentioned on the site yet.
- **Accessibility:** real buttons and links, visible `:focus-visible`, labels on every input,
  `aria-live` for toasts, 44px touch targets, `prefers-reduced-motion` respected.
- **Design:** read `DESIGN.md` before adding UI. Reuse tokens from `src/styles/tokens.css`.

## Portal (phase 1: ordering)

Off until `NEXT_PUBLIC_PORTAL_ENABLED=true` and the Supabase env vars are set; with it off, `/account` shows the
"sign-in opens soon" panel and `/list` stays static.

- **Sign-in:** email code (Supabase Auth OTP, `shouldCreateUser: false`; Matt adds users in the dashboard).
  Sign-ups are off in Supabase. Codes go out through Resend SMTP from `signin@mail.morsupply.com`; the email
  body is `supabase/templates/sign-in-code.html` and must keep `{{ .Token }}`.
  Server actions in `src/app/[locale]/account/actions.ts`. `src/lib/portal.ts` builds a user-scoped client
  with the publishable key, so row level security applies to every read. The proxy refreshes the session on
  `/account/*` and `/list`.
- **Data:** `supabase/migrations/20261110000000_portal.sql`. Customers read only their own accounts, orders
  and usual order. Writes go through `place_order` and `save_usual_order`, which price on the server:
  cost per case x (1 + tier markup), rounded to cents. Costs and markups are never readable by customers;
  never compute prices in the browser. An account with no tier sees no prices.
- **Admin:** the Supabase dashboard (Table Editor). Costs load with `public.load_costs` from the cost sheet.
- **Supabase project:** MOR Supply, ref `kzfjwdqjjpxogoqrzwtc`, East US (us-east-1), next to Vercel's `iad1`.
  Migration history matches the file names in `supabase/migrations`.
- **Grants:** since Oct 30, 2026 Supabase gives `anon`, `authenticated` and `service_role` no access to new
  tables. Every migration that adds a table must grant exactly what the app uses, with RLS on.
- **New-order email:** `src/lib/notify.ts` via Resend when `RESEND_API_KEY`, `ORDER_EMAIL_FROM` and
  `ORDER_EMAIL_TO` are set; otherwise it logs. It never fails an order.
- **Language cookie:** set only on real page loads (`Sec-Fetch-Dest: document`). Next strips its router
  headers before the proxy runs, so `rsc` and `next-router-prefetch` are not visible there.
