# MOR Supply: notes for coding agents

Next.js 16 App Router, React 19, TypeScript, CSS Modules. No UI framework. Deployed on Vercel from `main`.

Commands: `npm run dev`, `npm run typecheck`, `npm run build`.

## Rules

- **Secrets:** never commit or print them. Server code reads `SUPABASE_URL` and `SUPABASE_SECRET_KEY`
  from the environment through `src/lib/supabase.ts` (server-only). The portal also reads
  `SUPABASE_PUBLISHABLE_KEY` (in `src/lib/portal.ts` and `src/proxy.ts`). Nothing secret gets a `NEXT_PUBLIC_` prefix.
- **Four languages:** every visible string lives in `src/i18n/en.ts` and the same key in `es.ts`, `tr.ts`
  and `ar.ts`. `Dict` is typed from English, so a missing key fails the typecheck. Use `plural()` for
  counts (Arabic has six forms; case units such as rolls and boxes are counted the same way) and
  `formatNumber()` for numbers (Latin digits everywhere). `formatMoney()` writes "$1,234.50" in every
  language, the way the invoice shows it.
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
- **Links:** use `IntentLink` (not `Link`) for links to the home page, product pages and category pages.
  A plain `Link` fetches its page as soon as it is on screen, and that also downloads the photos the
  page asks for first: every page used to pull in the three home page photos (325 KB). `IntentLink`
  fetches when someone hovers, touches or focuses the link.
- **Content security policy:** set in `next.config.ts` for production builds. Everything loads from this
  site only. If you add a script, font, image host or API on another origin, add it there, and keep the
  tests' "the content security policy blocked nothing" checks green.
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
  `/account/*` and `/list`. The sign-in cookie is HttpOnly and Secure (`src/lib/session-cookie.ts`): only the
  server reads it, so never add a Supabase client that runs in the browser.
- **Business form** (`/account/setup`): required fields first, the text message box, then one closed group of
  optional details (type of business, language, rep code). `validateSetup` runs in the browser before anything
  is sent, and `createAccount` sends back what was typed (`SetupState.values`) when it finds a problem, so the
  form never empties. A select needs a `key` to take a new default after a form reset. The page carries
  `data-one-job`, which folds the footer down to its closing line. A new account lands on
  `/products?welcome=1` (`Welcome` says it is ready, once, to someone signed in).
- **Reordering:** the account page is where a signed-in customer lands, and the usual order leads it: lines,
  what each comes to, the total with delivery (today's prices from the database, added up on the server for
  reading only) and one button, "Order my usual", which puts it on the list. Each recent order has
  "Order again" (`OrdersTable`, only the lines that are for sale). The list's confirmation shows the total
  `place_order` returned and offers "Make this my usual order" unless the order already is.
- **Landing:** `src/proxy.ts` sends a home page load to `/account` when a sign-in cookie is present and the
  visit starts outside the site (`Sec-Fetch-Site` is `none` or `cross-site`). The logo and other links inside
  the site still open the home page. The cookie is only a hint; the account page checks the session.
- **Wording by sign-in:** built pages are the same for everyone. `SessionLink` and `SessionText` swap a link
  or a sentence once `/api/session` answers (home page buttons). Prefer one sentence that is true for both
  (the products page) so nothing moves; pages rendered per request (the list) choose on the server.
- **Toasts** belong to the page they were shown on and go when the visitor moves on. Pass `travels: true`
  for one shown just before a move and meant for the next page (`ToListButton`).
- **Data:** `supabase/migrations/20261110000000_portal.sql`, `20261110190000_open_signup_pricing.sql` and
  `20261111150518_priced_skus.sql`.
  Customers read only their own accounts, orders and usual order. Writes go through `place_order`,
  `save_usual_order` and `create_my_account`. Prices: cost per case / (1 - margin), rounded to cents, one
  margin for everyone (25%). Each order copies a delivery fee and, if `next_day`, a next-day fee. The margin
  and fees live in `public.pricing` (one row); customers can call `order_fees()` but never read costs or the
  margin. Never compute prices in the browser; the list's totals are display only. Switched-off accounts
  (`accounts.active = false`) see no prices and cannot order.
- **Items without a price are hidden:** the site sells only SKUs that have a cost in `public.product_costs`.
  `src/lib/availability.ts` asks `public.priced_skus()` with the server key (SKUs only, never a cost), and
  `src/lib/shelf.ts` turns the answer into the shelf: the products, sizes and categories that are for sale.
  Every page that shows products reads the shelf, never `src/data/catalog.ts` directly. `allProducts()` and
  `allCategories()` only name the pages to build; `findVariant()` names SKUs on past orders and in emails.
  A product or category with nothing to sell answers 404. Pages refresh by themselves about every
  5 minutes (ISR, set by the fetch in `availability.ts`), so a loaded cost needs no deploy. If Supabase
  cannot be reached, built pages keep their last good version, and a build fails rather than put unpriced
  items on show. `placeOrder` and `saveUsualOrder` ask again at that moment and hold the order back if an
  item went off sale. `SHOW_UNPRICED=true` (server env, needs a deploy) shows everything again, with
  "To be confirmed" on items without a price.
- **Prices on product pages:** the pages are built ahead of time, the same for everyone, so a signed-in
  customer's prices load after the page from `/api/prices` (the same `my_prices` call as the list), once
  `/api/session` says someone is signed in.
  `src/lib/price-store.ts` keeps them in memory between product pages and drops them at sign-out. On phones
  the price sits at the end of the case line, so rows do not grow when it arrives. Product cards show
  the lowest price per case among the product's sizes ("From $36.00") on the photo tile (`CardPrice`),
  so cards keep their height too. That picks one of the database's prices; it never works one out.
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
  An order email lists each line with the price per case the database saved and what the line comes to.
  `RESEND_API_URL` is for the tests only: it points the sender at the mock.
  All three are set in Vercel for production only. The sender is on `mail.morsupply.com`, the domain
  verified in Resend.
- **Language cookie:** set only on real page loads (`Sec-Fetch-Dest: document`). Next strips its router
  headers before the proxy runs, so `rsc` and `next-router-prefetch` are not visible there.
