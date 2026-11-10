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
| Sign in | `/account/sign-in` | Email code sign-in. Shows "opens soon" while the portal is off |
| Your account | `/account`, `/account/orders` | Client portal: usual order, order history, reorder |
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

1. Create a Supabase project and apply every file in `supabase/migrations` in order (SQL editor,
   `supabase db push`, or Claude's Supabase connector).
2. In Vercel, add `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (server-only, never `NEXT_PUBLIC_`).
3. Redeploy. Until then the form shows a message asking people to contact their rep.

## Client portal

Phase 1 is ordering. Customers sign in with an email code, see their account's prices on the list, place
orders, save a usual order and reorder from history. Prices are cost per case x (1 + the account's tier
markup), computed in the database. An account with no tier sees no prices. It stays off until step 4.

1. Apply the migrations (see above). Production is the Supabase project MOR Supply in East US, set up Nov 10, 2026.
2. Supabase Auth:
   - Sign In / Providers: turn off "Allow new users to sign up". Customers are added by hand.
   - Emails > SMTP Settings: Resend (`smtp.resend.com`, port 465, user `resend`, password = a Resend API key
     with sending access to `mail.morsupply.com` only). Sender `signin@mail.morsupply.com`, name `MOR Supply`.
     The built-in sender only reaches your own team, and the templates stay locked until custom SMTP is on.
   - Emails > Magic link or OTP: subject `{{ .Token }} is your MOR Supply sign-in code`, body
     `supabase/templates/sign-in-code.html`. The portal signs in with the code, not a link.
   - Codes are 8 digits and last 1 hour (Sign In / Providers > Email).
3. In Vercel, add `SUPABASE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_PORTAL_ENABLED=true`. Optional for new-order
   emails: `RESEND_API_KEY`, `ORDER_EMAIL_FROM`, `ORDER_EMAIL_TO`.
4. Redeploy.

Day to day, in the Supabase dashboard:

- Add a customer: Authentication > Users > Add user > Create new user (not "Send invitation": the invite
  email has a link the portal doesn't use), then in the SQL editor
  `select * from public.link_customer('owner@example.com', 'Business name');`
- Show prices: set `accounts.tier` to XL, L, M, S or XS (markups in `price_tiers`).
- Load costs: `public.load_costs` with columns copied from the cost sheet.
- Move orders along: `orders.status` is received, confirmed, out_for_delivery, delivered or canceled.
