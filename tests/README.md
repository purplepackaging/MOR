# Tests

Checks used to ship the site and the client portal. They live outside the app so Vercel never installs them.
Playwright is not listed here: use the copy preinstalled in Claude's cloud workspace, or locally run
`npm i -D playwright && npx playwright install chromium` in this folder.

```bash
cd tests && npm install
```

| Check | Command | What it covers | Last result |
| --- | --- | --- | --- |
| Database | `npm run db` | Applies `supabase/migrations` to PGlite (Postgres 18 in WASM) with stand-ins for Supabase roles and `auth.uid()`. RLS, grants, 25% margin pricing, delivery and next-day fees, open sign-up (`create_my_account`), switched-off accounts, `load_costs`, `link_customer`, tiers removed over existing data, each migration runs twice cleanly | 81/81 pass (Nov 10, 2026) |
| Portal end to end | see below | Sign-in by code, open sign-up and the business form, prices on product pages (a column at 1280 px, on the case line at 390 px, rows do not move, four languages, gone at sign-out and for switched-off accounts), prices and line totals on the list, delivery and next-day fees, totals, card fee note, the order bar on phones, the 999-case limit message, 44 px steppers, the spoken total, no layout shift on the list page, place order, usual order, reorder, order pages, Arabic, 404s, signed-out list, sign-in links that try to leave the site (`next`), axe on every portal page, at 1280 and 390 px | 166/166 pass (Nov 10, 2026) |
| Public pages | `npm run axe` | axe-core on 11 public pages at 1366 and 390 px | clean (Nov 10, 2026) |

## Portal end to end

The portal needs Supabase, so these runs use `mock-supabase/server.mjs`: a small stand-in for Supabase Auth
and the Data API (`owner@kebab.test` owns Kebab House; `paused@spot.test` belongs to a switched-off account;
any other email signs up; every code is `123456`; 25% margin, $50 delivery, $50 next-day).

```bash
# terminal 1, from tests/
npm run mock                                  # 127.0.0.1:54321

# terminal 2, from the repo root
NEXT_PUBLIC_PORTAL_ENABLED=true npm run build
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE_KEY=sb_publishable_test npx next start -p 3123

# terminal 3, from tests/
npm run portal                                # BASE=http://localhost:3123 by default
```

For `npm run axe`, use the same build and servers: production runs with the portal on (since Nov 10, 2026).

Restart the mock before each run: it keeps sign-ups and orders in memory, so a second run finds its "new" emails
already set up and stops.

The mock only imitates the Supabase calls the portal makes. Row level security and grants are covered by the
database tests, which run the real migrations.
