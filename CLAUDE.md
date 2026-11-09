# MOR Supply: notes for coding agents

Next.js 16 App Router, React 19, TypeScript, CSS Modules. No UI framework. Deployed on Vercel from `main`.

Commands: `npm run dev`, `npm run typecheck`, `npm run build`.

## Rules

- **Secrets:** never commit or print them. Server code reads `SUPABASE_URL` and `SUPABASE_SECRET_KEY`
  from the environment through `src/lib/supabase.ts` (server-only). Nothing secret gets a `NEXT_PUBLIC_` prefix.
- **Four languages:** every visible string lives in `src/i18n/en.ts` and the same key in `es.ts`, `tr.ts`
  and `ar.ts`. `Dict` is typed from English, so a missing key fails the typecheck. Use `plural()` for
  counts (Arabic has six forms) and `formatNumber()` for numbers (Latin digits everywhere).
- **Right to left:** Arabic pages set `dir="rtl"`. Use logical CSS (`inset-inline-start`, `padding-inline`,
  `text-align: start`). Mirror only directional icons.
- **Routing:** `src/proxy.ts` serves English at the root and rewrites to `/en`. Build links with
  `localePath(locale, path)`, never by hand.
- **Catalog:** `src/data/catalog.ts`. SKUs are permanent IDs; never rename one that has been used.
  The build fails on duplicate SKUs or broken `goesWith` links.
- **Copy:** sentence case, short sentences, plain verbs, no em dashes. Prices are never shown publicly.
  Spices and dry goods are planned but not mentioned on the site yet.
- **Accessibility:** real buttons and links, visible `:focus-visible`, labels on every input,
  `aria-live` for toasts, 44px touch targets, `prefers-reduced-motion` respected.
- **Design:** read `DESIGN.md` before adding UI. Reuse tokens from `src/styles/tokens.css`.

## Portal (planned)

Sign-in goes at `/account/sign-in` behind `NEXT_PUBLIC_PORTAL_ENABLED`. Use Supabase Auth and row level
security; add migrations under `supabase/migrations/`. The list store (`src/lib/list-store.ts`) uses
`{ sku, cases }` lines so it can sync to a signed-in account.
