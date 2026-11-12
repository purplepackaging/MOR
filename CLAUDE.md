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
  `localePath(locale, path)`, never by hand. A page built ahead of time knows itself as `/en/...`, and
  whatever the server writes into a link stays once the page is running, so read the current path in the
  header through `usePublicPath()` (`HeaderClient.tsx`), never straight from `usePathname()`.
- **Catalog:** `src/data/catalog.ts`. SKUs are permanent IDs; never rename one that has been used.
  The build fails on duplicate SKUs or broken `goesWith` links.
- **Photos:** `public/img/products/`, transparent WebP cut-outs, two files each: `name.webp` (1000 px on
  its long side, 600 at least) and `name-480.webp` (the same photo at 480 px). `ProductVisual` gives the
  browser both and says how wide the photo is drawn (`sizes`), so cards and lists take the small file and
  the product page the large one. The build fails if a catalog photo lacks either file. Browsers keep a
  photo for a day, so after replacing one under the same name raise `PHOTO_VERSION` in `ProductVisual.tsx`
  (it is the `?v=` on every photo address). A tile that holds a
  photo has a deeper floor and a soft shadow under the photo (`src/styles/base.css`). The shadow is drawn on
  `.shot`, a layer that covers the whole tile, never on the `img`: Safari cuts a filter on an image off at the
  image's own box, which showed as straight lines across the tile on iPhones. Look at a new
  photo on the tile before it ships: the shadow shows a ragged cut-out or a leftover patch of studio white.
- **Product page:** `SizeTable` in the product page draws the sizes of one product, each with Add. A column
  that reads the same on every size for sale (color, lid size) moves up as a pill under the name, as long
  as one column is left to tell the sizes apart. The material and the size range are one line under the
  name (`sizeRange`). On a cup (size in oz, `fits` in mm) the `fits` column is headed "Lid size". The case
  column holds the count only; on phones "per case" is drawn around it from `product.perCase`
  (`data-before`, `data-after`), so the cell's own text stays the count. Seven sizes or more in two to
  five colors get a color filter: radio buttons and `:has()` in `product.module.css`, no script.
- **Goes with:** `fitsFor` in `src/lib/catalog.ts` picks the sizes of each related product that the catalog
  says fit this one ("fits 12–24 oz" covers a 16 oz cup; where both sides give a rim in mm they must
  agree; a fit written in words is left out). Those sizes show with Add. Never add a fit the data does
  not state.
- **Search:** `searchText` builds what search reads for a product: its names in four languages, its
  category, sizes, material and its search words (`src/data/search-words.ts`, the other words kitchens use,
  keyed by slug; the build fails on a slug that is not in the catalog). A search word names the same thing
  as the product. It is never a claim about it and never a brand name (Matt, Nov 12). `matchesQuery` (`src/lib/text.ts`): every word typed has
  to start a word of that text when it is in Latin letters or digits ("pan" finds "foil pans", not
  "Spanish"); other scripts match anywhere, because Arabic joins "the" to a word. `nameRank` puts a product
  whose own name answers the search first. The home page's search field is a plain form that opens
  `/products?q=...`.
- **Product browser** (`ProductBrowser`, the products page and category pages): the search field scrolls
  away; `.bar` stays under the header. From 640 px the bar holds every category chip, wrapped, and the
  plant-based filter sits beside the search field. Below 640 px the bar holds one button named after the
  category on show, which opens the same chips and the filter in a panel under the bar (closes on Escape,
  on a tap outside and on a choice). The filter button is in the page twice and CSS shows one of them.
  The search button at the bar's end always keeps its place and shows once the field is out of sight
  (`searchAway`), so nothing in the bar moves. No string is new: the button reuses "Categories" and
  "Search products".
- **Cards:** `productDetail` writes the line under a product's name ("5 sizes: 9, 10, 12, 16, 24 oz").
  `ProductCard` is a line on phones and a card from 640 px; the grids that hold it are one column below
  640 px (`ProductBrowser.module.css`, `home.module.css`).
- **List bar:** `ListBar` is fixed to the foot of a phone's product page once the list has an item. Like the
  order bar on the list page, it sets `--bottom-bar` to its height: toasts, focus and the footer's last line
  stay clear of it. Where it shows, the "Added" toast is hidden from sight and still spoken
  (`Toaster.module.css`).
- **Not-found title:** a product or category with nothing to sell is built ahead of time as "not found",
  and Next gives that page the site's default title whatever the route's metadata says. `PageTitle` in
  `not-found.tsx` sets it in the browser.
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
- **Self-service:** the account page shows the business (address, contact, phone). Its owner corrects it at
  `/account/details` (`update_my_account`; staff added as buyers read it only). An order can be canceled on
  its page while it is still "received" (`cancel_my_order`, two taps; the database decides, and answers
  `too_late` once the team has confirmed it). The team gets an email for each: what changed, old value then
  new, and which order was canceled. `supabase/migrations/20261111191720_self_service.sql`.
- **Weekly order (part 1, asking):** under the usual order on the account page a customer asks for it every
  week (`set_weekly_order`), skips the coming delivery (`skip_weekly_order`) or turns it off. The calendar is
  `public.next_delivery(day)`: an order closes at 5 pm Eastern, two days before the delivery date. Nothing is
  placed automatically yet. `pricing.weekly_orders_on` (false) is the switch for the whole site; while it is
  off, or an account has no `delivery_day`, the page says "You asked for a weekly order" and promises no
  date. The team gets an email when someone asks or stops. Part 2 (not built): placing the orders at the
  cutoff, the reminder the day before, and emails to customers. Do not turn the switch on before part 2.
  Customer emails will take replies at `orders@morsupply.com` (Matt, Nov 11); delivery days are not set yet.
  `supabase/migrations/20261111194417_weekly_order.sql`.
- **Toasts** belong to the page they were shown on and go when the visitor moves on. Pass `travels: true`
  for one shown just before a move and meant for the next page (`ToListButton`).
- **Data:** `supabase/migrations/20261110000000_portal.sql`, `20261110190000_open_signup_pricing.sql` and
  `20261111150518_priced_skus.sql`.
  Customers read only their own accounts, orders and usual order. Writes go through `place_order`,
  `save_usual_order`, `create_my_account`, `update_my_account`, `cancel_my_order`, `set_weekly_order` and
  `skip_weekly_order`. Prices: cost per case / (1 - margin), rounded to cents, one
  margin for everyone (30% since Nov 12, 2026; 25% before). Each order copies a delivery fee and, if `next_day`, a next-day fee. The margin
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
  the lowest price per case among the product's sizes ("From $36.00") on the card's last line (`CardPrice`).
  That line is there for everyone and empty until a price arrives, so cards keep their height too. That picks one of the database's prices; it never works one out.
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
