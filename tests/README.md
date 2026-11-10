# Tests

Checks used to ship the site and the client portal. They live outside the app so Vercel never installs them.
Playwright is not listed here: use the copy preinstalled in Claude's cloud workspace, or locally run
`npm i -D playwright && npx playwright install chromium` in this folder.

```bash
cd tests && npm install
```

| Check | Command | What it covers | Last result |
| --- | --- | --- | --- |
| Database | `npm run db` | Applies `supabase/migrations` to PGlite (Postgres 18 in WASM) with stand-ins for Supabase roles and `auth.uid()`. RLS, grants, pricing math, tiers, paused accounts, `load_costs`, `link_customer`, runs twice cleanly | 53/53 pass (Nov 10, 2026) |
| Portal end to end | see below | Sign-in by code, no email enumeration, prices and subtotal, place order, usual order, reorder, order pages, Arabic, 404s, unlinked and no-tier accounts, axe on every portal page, at 1280 and 390 px | 66/66 pass (Nov 10, 2026) |
| Public pages | `npm run axe` | axe-core on 11 public pages at 1366 and 390 px | clean (Nov 10, 2026) |

## Portal end to end

The portal needs Supabase, so these runs use `mock-supabase/server.mjs`: a small stand-in for Supabase Auth
and the Data API (users `owner@kebab.test`, tier markup 30%; `taco@spot.test`, no tier; `new@user.test`, no
account; every code is `123456`).

```bash
# terminal 1, from tests/
npm run mock                                  # 127.0.0.1:54321

# terminal 2, from the repo root
NEXT_PUBLIC_PORTAL_ENABLED=true npm run build
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE_KEY=sb_publishable_test npx next start -p 3123

# terminal 3, from tests/
npm run portal                                # BASE=http://localhost:3123 by default
```

For `npm run axe`, build without the portal flag (production settings) and start `npx next start -p 3123`.

The mock only imitates the Supabase calls the portal makes. Row level security and grants are covered by the
database tests, which run the real migrations.
