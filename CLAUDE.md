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
  (only to signed-in customers with an active account).
  Spices and dry goods are planned but not mentioned on the site yet.
- **Accessibility:** real buttons and links, visible `:focus-visible`, labels on every input,
  `aria-live` for toasts, 44px touch targets, `prefers-reduced-motion` respected.
- **Design:** read `DESIGN.md` before adding UI. Reuse tokens from `src/styles/tokens.css`.

## Portal (phase 1: ordering)

Off until `NEXT_PUBLIC_PORTAL_ENABLED=true` and the Supabase env vars are set; with it off, `/account` shows the
"sign-in opens soon" panel and `/list` stays static.

- **Sign-in and sign-up:** email and password (`passwordSignIn`), or a code by email (Supabase Auth OTP,
  `shouldCreateUser: true`; `?code=1` opens on that form). Open sign-up: a new email gets a login
  (`?new=1`), chooses a password on the code step, and the first sign-in goes to `/account/setup`, which
  calls `create_my_account` (one business per sign-up, owner role). `/request-account` forwards there when
  the portal is on. A password is only ever saved in `verifyCode`, right after a fresh code has proved the
  email: that one step serves new accounts, forgotten passwords and password changes (`?reset=1`, linked from
  the account page). 8 characters or more, 72 bytes at most. A wrong password and an unknown email get the
  same answer. `user_metadata.has_password` only picks the wording of that link; never use it to decide
  access. Keep `autocomplete` on the fields (`username`, `current-password`, `new-password`,
  `one-time-code`): browsers save and fill passwords by it. Codes go out
  through Resend SMTP from `signin@mail.morsupply.com`; the "Magic link or OTP" and "Confirm sign up"
  emails both use `supabase/templates/sign-in-code.html` and must keep `{{ .Token }}`.
  Server actions in `src/app/[locale]/account/actions.ts`. `src/lib/portal.ts` builds a user-scoped client
  with the publishable key, so row level security applies to every read. The proxy refreshes the session on
  `/account/*` and `/list`.
- **Data:** `supabase/migrations/20261110000000_portal.sql` and `20261110190000_open_signup_pricing.sql`.
  Customers read only their own accounts, orders and usual order. Writes go through `place_order`,
  `save_usual_order` and `create_my_account`. Prices: cost per case / (1 - margin), rounded to cents, one
  margin for everyone (25%). Each order copies a delivery fee and, if `next_day`, a next-day fee. The margin
  and fees live in `public.pricing` (one row); customers can call `order_fees()` but never read costs or the
  margin. Never compute prices in the browser; the list's totals are display only. Switched-off accounts
  (`accounts.active = false`) see no prices and cannot order.
- **Prices on product pages:** the pages are static, so a signed-in customer's prices load after the page
  from `/api/prices` (the same `my_prices` call as the list), once `/api/session` says someone is signed in.
  `src/lib/price-store.ts` keeps them in memory between product pages and drops them at sign-out. On phones
  the price sits at the end of the case line, so rows do not grow when it arrives.
- **Your list:** each priced line shows what it comes to. Below 960px an order bar (total and Place order)
  shows while the summary's own button is below the screen; `--bottom-bar` lifts toasts and focus above it.
  One item takes 1 to 999 cases (`src/lib/limits.ts`; the order actions check the same limit).
- **Admin:** the Supabase dashboard (Table Editor). Costs load with `public.load_costs` from the cost sheet.
  Migrations that drop anything need a person to confirm them in the SQL Editor; then add the row to
  `supabase_migrations.schema_migrations` so the history keeps matching the files.
- **Card surcharge:** `site.cardSurchargePercent` (3). Shown on the list, FAQ and terms; charged by the card
  processor at payment, credit cards only. Not part of order totals.
- **Supabase project:** MOR Supply, ref `kzfjwdqjjpxogoqrzwtc`, East US (us-east-1), next to Vercel's `iad1`.
  Migration history matches the file names in `supabase/migrations`.
- **Grants:** since Oct 30, 2026 Supabase gives `anon`, `authenticated` and `service_role` no access to new
  tables. Every migration that adds a table must grant exactly what the app uses, with RLS on.
- **Team emails:** `src/lib/notify.ts` sends new orders and new accounts via Resend when `RESEND_API_KEY`,
  `ORDER_EMAIL_FROM` and `ORDER_EMAIL_TO` are set; otherwise it logs. It never fails the customer's action.
- **Language cookie:** set only on real page loads (`Sec-Fetch-Dest: document`). Next strips its router
  headers before the proxy runs, so `rsc` and `next-router-prefetch` are not visible there.
