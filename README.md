# MOR Supply

Website for morsupply.com: restaurant supplies sold by the case, in English, Spanish, Turkish and Arabic.
Next.js 16 on Vercel. Pushes to `main` deploy to production.

```
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run build
```

Never commit secrets. API keys live in Vercel project environment variables only.

## What's here

| Page | Path | Notes |
| --- | --- | --- |
| Home | `/` | Hero, categories, how ordering works, staples, questions |
| Products | `/products`, `/products/[category]` | Search, category filters, plant-based filter |
| Product | `/products/[category]/[product]` | Sizes and case packs, Add to list |
| Your list | `/list` | Saved on the visitor's device until sent |
| Request an account | `/request-account` | Saves to Supabase with the list and rep code |
| Sign in | `/account/sign-in` | Placeholder until the client portal ships |
| Legal | `/privacy`, `/terms`, `/sms-terms` | English text, translated titles |
| Rep QR codes | `/r/CODE` | Remembers the rep for 180 days, opens the request form |

English lives at the root. Other languages are prefixed: `/es`, `/tr`, `/ar` (right to left).
A first visit picks the browser language; the language menu choice is remembered.

## Where to change things

- **Products:** `src/data/catalog.ts`. SKUs are MOR's own and must never change once used.
  Product photos go in `public/img/products/` as transparent WebP.
- **Words on the site:** `src/i18n/en.ts`, then the same key in `es.ts`, `tr.ts`, `ar.ts`.
- **Phone, email, card surcharge:** `src/config/site.ts`.
- **Sales reps:** `src/config/reps.ts` (display names) and the `reps` table in Supabase.
- **Design tokens:** `src/styles/tokens.css`. See `DESIGN.md`.

## Turning on the request form

1. Create a Supabase project and run `supabase/migrations/20261109000000_init.sql` in its SQL editor.
2. In Vercel, add `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (server-only, never `NEXT_PUBLIC_`).
3. Redeploy. Until then the form shows a message asking people to contact their rep.

## Client portal (next)

The site is built so the portal drops in without moving anything:

- Sign-in lives at `/account/sign-in`; every "Sign in" link already points there.
- `NEXT_PUBLIC_PORTAL_ENABLED=true` switches the portal on.
- The list is stored as `{ sku, cases }` lines, the same shape a saved order or usual order will use,
  so a signed-in list can sync to the account.
- Plan: Supabase Auth (email or phone sign-in, unique per user), tables `accounts`, `account_users`,
  `orders`, `order_lines`, `usual_orders`, with row level security so each user only sees their account.
