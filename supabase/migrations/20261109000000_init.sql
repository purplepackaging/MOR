-- MOR Supply: first tables (website launch).
--
-- Row level security is on and no policies exist, so the browser (anon and
-- authenticated roles) can never read or write these tables. Only the server,
-- using the secret key stored in Vercel, can reach them.
--
-- Run in Supabase: SQL Editor -> paste -> Run. Or: supabase db push.

-- Sales reps and the codes printed on their flyers (morsupply.com/r/CODE).
create table if not exists public.reps (
  code        text primary key check (code ~ '^[A-Z0-9]{1,12}$'),
  name        text not null,
  phone       text,
  email       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Account requests from the website form.
create table if not exists public.account_requests (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  status              text not null default 'new'
                      check (status in ('new', 'contacted', 'approved', 'declined', 'spam')),

  business_name       text not null check (char_length(business_name) between 1 and 120),
  business_type       text not null
                      check (business_type in ('restaurant', 'cafe', 'caterer', 'hotel', 'foodTruck', 'market', 'other')),
  contact_name        text not null check (char_length(contact_name) between 1 and 80),
  phone               text not null check (phone ~ '^\+1[2-9][0-9]{9}$'),
  email               text check (email is null or char_length(email) <= 160),
  street              text not null check (char_length(street) <= 160),
  city                text not null check (char_length(city) <= 80),
  zip                 text not null check (zip ~ '^[0-9]{5}$'),

  preferred_language  text not null default 'en' check (preferred_language in ('en', 'es', 'tr', 'ar')),
  site_locale         text not null default 'en' check (site_locale in ('en', 'es', 'tr', 'ar')),
  -- Not a foreign key on purpose: codes from new flyers are kept even before the rep is added.
  rep_code            text check (rep_code is null or rep_code ~ '^[A-Z0-9]{1,12}$'),
  channels            text[] not null default '{}',
  notes               text check (notes is null or char_length(notes) <= 1000),
  -- [{ "sku": "CUP-PET-16", "cases": 4, "name": "...", "option": "..." }]
  items               jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),

  -- Text message consent record (10DLC): what they agreed to, and when.
  sms_consent         boolean not null default false,
  sms_consent_text    text,
  sms_consent_at      timestamptz,
  client_ip           text,
  user_agent          text,

  constraint sms_consent_recorded
    check (not sms_consent or (sms_consent_text is not null and sms_consent_at is not null))
);

create index if not exists account_requests_created_at_idx on public.account_requests (created_at desc);
create index if not exists account_requests_status_idx on public.account_requests (status);
create index if not exists account_requests_rep_code_idx on public.account_requests (rep_code);

alter table public.reps enable row level security;
alter table public.account_requests enable row level security;

-- Belt and braces: the public roles get no table privileges at all.
revoke all on public.reps from anon, authenticated;
revoke all on public.account_requests from anon, authenticated;
