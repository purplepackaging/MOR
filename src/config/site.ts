/**
 * Business settings shown on the site. Edit here; every page reads from this file.
 * Leave a contact field null to hide it everywhere.
 */
export const site = {
  name: "MOR Supply",
  legalName: "Purple Packaging LLC",
  /**
   * Canonical origin for links, sitemap and social previews. On Vercel this follows the
   * project's production domain, so it becomes morsupply.com once that domain is attached.
   */
  url:
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://morsupply.com"),
  /** E.164, e.g. "+14045550123". Shows call and text links when set. */
  phone: null as string | null,
  /** E.164 number used for WhatsApp. */
  whatsapp: null as string | null,
  email: null as string | null,
  /**
   * Credit card surcharge in percent. Debit, ACH and bank payments are never surcharged.
   * Card rules cap it at what card acceptance actually costs you (Visa: 3% at most).
   */
  cardSurchargePercent: 3,
  /** Turns on sign-in and account pages once the portal is built. */
  portalEnabled: process.env.NEXT_PUBLIC_PORTAL_ENABLED === "true",
};

/** Cookie set by /r/CODE so requests credit the rep whose flyer was scanned. */
export const REP_COOKIE = "mor_rep";
