# Tests

Checks used to ship the site and the client portal. They live outside the app so Vercel never installs them.
Playwright is not listed here: use the copy preinstalled in Claude's cloud workspace, or locally run
`npm i -D playwright && npx playwright install chromium` in this folder.

```bash
cd tests && npm install
```

| Check | Command | What it covers | Last result |
| --- | --- | --- | --- |
| Database | `npm run db` | Applies `supabase/migrations` to PGlite (Postgres 18 in WASM) with stand-ins for Supabase roles and `auth.uid()`. RLS, grants, 25% margin pricing, delivery and next-day fees, open sign-up (`create_my_account`), switched-off accounts, `load_costs`, `link_customer`, tiers removed over existing data, `priced_skus` (SKUs only, server key only), each migration runs twice cleanly | 89/89 pass (Nov 11, 2026) |
| Portal end to end | see below | Sign-in by password and by code, the sign-in cookie's flags (HttpOnly, Secure, SameSite=Lax), password manager field hints, the same answer for a wrong password and an unknown email, open sign-up with a password and the business form (at most 1.75 screens on a phone, fields checked in the browser before anything is sent, everything typed kept when saving fails, optional details closed, the welcome note on the products page), changing a password behind a fresh code, a refused password, the old password dying, prices on product pages (a column at 1280 px, on the case line at 390 px, rows do not move, four languages, gone at sign-out and for switched-off accounts), prices on product cards (lowest price per case, four languages, cards do not move, none signed out or switched off), prices and line totals on the list, delivery and next-day fees, totals, card fee note, the order bar on phones, the 999-case limit message, 44 px steppers, the spoken total, no layout shift on the list page, place order, the team's alert emails (each line's price and amount, fees, note, no stray blank line, new accounts), usual order, reorder, order pages, toasts that stay on the page they were shown on, Arabic, 404s, signed-out list, pages fetched only when a link is reached for (no home page photos on other pages), sign-in links that try to leave the site (`next`), the content security policy (present, and it blocks nothing in the whole run), axe on every portal page, at 1280 and 390 px | 297/297 pass with items hidden, 293/293 with `SHOW_UNPRICED=true` (Nov 11, 2026) |
| Hidden items | `npm run hidden` | Items without a price stay off the site: listings, search, product pages (only priced sizes), "Goes with", home page counts and staples, footer, sitemap, 404 for a hidden product or category in four languages. A loaded cost puts the item on the site with no deploy, and taking it away hides it again. The corrected site data (blue foil sheet, film case packs) and unit words that follow the count ("1 roll", four languages). Pages keep their last good version while Supabase cannot be reached. A saved list loses hidden lines with a note (no layout shift, four languages). Usual orders and past orders mark such items and leave them out of reorders. An item that goes off sale while a page is open holds the order (and the usual order) back. The content security policy blocks nothing. axe on each state, at 1280 and 390 px | 87/87 pass (Nov 11, 2026) |
| Public pages | `npm run axe` | axe-core on 13 public pages at 1366 and 390 px, with items hidden (the last page is a hidden product, so it is the not-found page) | clean (Nov 11, 2026) |

## Portal end to end

The portal needs Supabase, so these runs use `mock-supabase/server.mjs`: a small stand-in for Supabase Auth
and the Data API (`owner@kebab.test` owns Kebab House; `paused@spot.test` belongs to a switched-off account;
any other email signs up; every code is `123456`; nobody has a password until a test sets one, and
`pwned-password` is always refused; 25% margin, $50 delivery, $50 next-day; `priced_skus` answers only to the
server key `sb_secret_test`; `/__test/costs` and `/__test/outage` let a test change costs or take that call down;
`/resend/emails` stands in for Resend and `/__test/emails` lists what the site sent).

The tests switch the browser's own cache off (`ctx.route`). `next start` sends "stale-while-revalidate" on
built pages, Chromium then re-checks cached pages in the background, and Playwright never sees those
re-checks finish, so waiting for the network to go quiet would hang. Vercel does not send that header to browsers.

```bash
# terminal 1, from tests/
npm run mock                                  # 127.0.0.1:54321

# terminal 2, from the repo root. The mock must be running: the build asks it which SKUs have a cost.
export NEXT_PUBLIC_PORTAL_ENABLED=true SUPABASE_URL=http://127.0.0.1:54321 \
  SUPABASE_PUBLISHABLE_KEY=sb_publishable_test SUPABASE_SECRET_KEY=sb_secret_test AVAILABILITY_TTL_SECONDS=2
# The team's emails go to the mock, where the portal run reads them.
export RESEND_API_URL=http://127.0.0.1:54321/resend RESEND_API_KEY=re_test \
  ORDER_EMAIL_FROM="MOR Supply <orders@mail.test>" ORDER_EMAIL_TO=team@mor.test
npm run build
npx next start -p 3123

# terminal 3, from tests/
npm run portal                                # BASE=http://localhost:3123 by default
npm run hidden
npm run axe
```

The site hides items without a price, as production does (since Nov 11, 2026). The mock has costs for 16 SKUs
in 14 products, so that is the whole shop in these runs. `AVAILABILITY_TTL_SECONDS=2` makes pages ask again
after 2 seconds instead of 5 minutes, so `npm run hidden` can load a cost and watch the page appear. It
changes the mock's costs as it goes and puts them back.

To check the other setting, add `SHOW_UNPRICED=true` to terminal 2 (before the build) and run
`SHOW_UNPRICED=true npm run portal`. `npm run hidden` and `npm run axe` are for the default only.

Restart the mock before each `npm run portal`: it keeps sign-ups and orders in memory, so a second run finds its
"new" emails already set up and stops.

The mock only imitates the Supabase calls the portal makes. Row level security and grants are covered by the
database tests, which run the real migrations.
