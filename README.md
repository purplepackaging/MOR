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
| Request an account | `/request-account` | With the portal on, forwards to account creation. Off: saves a request to Supabase |
| Sign in | `/account/sign-in` | Email code sign-in and sign-up (`?new=1`). Shows "opens soon" while the portal is off |
| Business setup | `/account/setup` | First sign-in: business, address, phone, then ordering |
| Your account | `/account`, `/account/orders` | Client portal: order guide, order history, reorder |
| Legal | `/privacy`, `/terms`, `/sms-terms` | English text, translated titles |
| Rep QR codes | `/r/CODE` | Remembers the rep for 180 days, opens account creation |

English lives at the root. Other languages are prefixed: `/es`, `/tr`, `/ar` (right to left).
A first visit picks the browser language; the language menu choice is remembered.

## Where to change things

- **Products:** `src/data/catalog.ts`. SKUs are MOR's own and must never change once used.
  Product photos go in `public/img/products/` as transparent WebP, two files each: `name.webp`
  (1000 px on its long side, 600 at least) and `name-480.webp` for cards and lists, for example
  `magick name.webp -resize '480x480>' -quality 80 name-480.webp`. The build fails if one is missing.
  After replacing a photo under the same name, raise `PHOTO_VERSION` in `src/components/ProductVisual.tsx`,
  or browsers keep showing the old one for a day.
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

Phase 1 is ordering. Anyone can create an account: they enter their email, type in the code we email them,
and on their first sign-in fill in a short business form. Then they see prices, place orders, save an order
guide and reorder from history. You confirm each order before it ships.

Prices and fees are set in the database, never in the browser:

- Price per case = cost per case / (1 - margin), rounded to cents. The margin is 30% (since Nov 12, 2026;
  25% before), so a $10.00 case sells for $14.29. Everyone gets the same margin.
- Delivery is free since Nov 12, 2026, and the list no longer offers next-day delivery (both fees were $50).
  Orders still copy both fees, at $0, so a fee can come back by changing the pricing row.
- The margin and both fees are the one row in `public.pricing`. Orders copy prices and fees when they are
  placed. The FAQ says delivery is free in words: if a fee comes back, change that answer in the four
  dictionaries too.
- Credit cards add a 3% surcharge (`cardSurchargePercent` in `src/config/site.ts`), charged by the card
  processor at payment, never on debit cards or bank payments. Card rules cap it at what card acceptance
  actually costs you, and the processor needs 30 days' notice before you start.

Only items with a price are on the site. A product shows once at least one of its sizes has a cost in
Supabase, and it lists only those sizes. A category with nothing to sell is left out of the menus.
Load a cost and the item appears by itself within about 5 minutes. No deploy is needed. The first visit
to a page after a change can still get the old page; refresh once. To show every item again, with
"To be confirmed" on the ones without a price, set `SHOW_UNPRICED=true` in Vercel and redeploy.

Setup (done for production on Nov 10, 2026):

1. Apply the migrations (see above). Production is the Supabase project MOR Supply in East US.
   `20261110190000_open_signup_pricing.sql` drops the old tiers, so run it in the SQL Editor and confirm.
2. Supabase Auth:
   - Sign In / Providers: "Allow new users to sign up" on. The site asks for a business before anything else.
   - Emails > SMTP Settings: Resend (`smtp.resend.com`, port 465, user `resend`, password = a Resend API key
     with sending access to `mail.morsupply.com` only). Sender `signin@mail.morsupply.com`, name `MOR Supply`.
     The built-in sender only reaches your own team, and the templates stay locked until custom SMTP is on.
   - Emails > Magic link or OTP and Confirm sign up: subject `{{ .Token }} is your MOR Supply sign-in code`,
     body `supabase/templates/sign-in-code.html`. New emails get the Confirm sign up email, returning
     customers get Magic link or OTP. The portal signs in with the code, not a link.
   - Codes are 8 digits and last 1 hour (Sign In / Providers > Email).
3. In Vercel, add `SUPABASE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_PORTAL_ENABLED=true`. For emails to you about
   new orders and new accounts: `RESEND_API_KEY` (a Resend key with sending access), `ORDER_EMAIL_FROM`
   (a sender on `mail.morsupply.com`, the domain verified in Resend) and `ORDER_EMAIL_TO`. Production only.
4. Redeploy.

Day to day, in the Supabase dashboard:

- New accounts: Table Editor > accounts (`created_by` is set when the customer made it themselves).
  Switch one off with `active`; its people can still sign in but cannot see prices or order.
- Add someone to an existing business (staff who order), before they sign in: Authentication > Users >
  Add user > Create new user, then in the SQL editor
  `select * from public.link_customer('buyer@example.com', 'Business name', 'buyer');`
  If they sign in first, the site asks them to set up a new business instead.
- Change the margin or fees: Table Editor > pricing.
- Load costs: `public.load_costs` with columns copied from the cost sheet. Items without a cost stay off
  the site until they have one.
- Move orders along: `orders.status` is received, confirmed, out_for_delivery, delivered or canceled.
  `orders.next_day` marks next-day requests, from orders placed before Nov 12, 2026 (the list no longer offers it).
