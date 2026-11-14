export const locales = ["en", "es", "tr", "ar"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

/** Cookie the proxy reads to remember a visitor's language. */
export const LOCALE_COOKIE = "mor_lang";

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

export const languageNames: Record<Locale, string> = {
  en: "English",
  es: "Español",
  tr: "Türkçe",
  ar: "العربية",
};

/** BCP 47 tags used for <html lang> and Intl formatting. */
export const htmlLang: Record<Locale, string> = {
  en: "en-US",
  es: "es-US",
  tr: "tr-TR",
  ar: "ar",
};

export function textDir(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

/**
 * Builds an in-site URL for a locale. English lives at the root
 * (/products), other languages are prefixed (/es/products).
 */
export function localePath(locale: Locale, path = "/"): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (locale === defaultLocale) return clean;
  return clean === "/" ? `/${locale}` : `/${locale}${clean}`;
}

/** Path used by the language switcher: /en/... sets the cookie, then redirects to the root path. */
export function switchPath(target: Locale, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return clean === "/" ? `/${target}` : `/${target}${clean}`;
}

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

export function formatNumber(locale: Locale, n: number): string {
  return new Intl.NumberFormat(htmlLang[locale], { numberingSystem: "latn" }).format(n);
}

export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export function plural(locale: Locale, n: number, forms: PluralForms): string {
  const rule = new Intl.PluralRules(htmlLang[locale]).select(n);
  return fill(forms[rule] ?? forms.other, { n: formatNumber(locale, n) });
}

/**
 * Keeps Latin sizes like "16 oz" or "10 × 100" in reading order inside Arabic text.
 * Wraps the value in invisible Unicode isolates (FSI…PDI) for right-to-left locales only.
 */
export function isolate(value: string, locale: Locale): string {
  return textDir(locale) === "rtl" && /[0-9A-Za-z]/.test(value) ? `\u2068${value}\u2069` : value;
}

const usDollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", numberingSystem: "latn" });

/**
 * "$1,234.50" in every language: the way the invoice, the card statement and the
 * bank show it. Turkish and Arabic write money their own way ("$1.234,50",
 * "1,234.50 US$"), which reads as a different amount beside a US invoice.
 *
 * In Arabic the amount is also kept together as one left-to-right unit (invisible
 * LRI…PDI marks); without them the "$" moves to the other side of the digits
 * whenever Arabic words come before it in the sentence.
 */
export function formatMoney(locale: Locale, amount: number): string {
  const money = usDollars.format(amount);
  return locale === "ar" ? `\u2066${money}\u2069` : money;
}

const wholeDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  numberingSystem: "latn",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * "$200" for a round amount in running text (the FAQ, the terms), where "$200.00" reads like an invoice
 * line. Amounts with cents come out as `formatMoney` writes them.
 */
export function formatDollars(locale: Locale, amount: number): string {
  if (!Number.isInteger(amount)) return formatMoney(locale, amount);
  const money = wholeDollars.format(amount);
  return locale === "ar" ? `\u2066${money}\u2069` : money;
}

/**
 * "Thursday, November 19" for a calendar date such as "2026-11-19": the day a delivery comes.
 * The month is written out: short months end in a period in Spanish, which doubles up at the end of a sentence.
 */
export function formatDay(locale: Locale, date: string): string {
  return new Intl.DateTimeFormat(htmlLang[locale], {
    weekday: "long",
    month: "long",
    day: "numeric",
    // A date with no time is read as midnight UTC, so it is written in UTC too.
    timeZone: "UTC",
    numberingSystem: "latn",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** "Tuesday, November 17 at 5:00 PM" on Atlanta time: the moment an order closes. */
export function formatDayTime(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(htmlLang[locale], {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    // Spanish writes "5:00 p.m.", whose last period doubles up at the end of a sentence: use "17:00".
    hourCycle: locale === "es" ? "h23" : undefined,
    timeZone: "America/New_York",
    numberingSystem: "latn",
  }).format(new Date(iso));
}

/** "Nov 10, 2026" in the reader's language, on Atlanta time. */
export function formatDate(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(htmlLang[locale], {
    dateStyle: "medium",
    timeZone: "America/New_York",
    numberingSystem: "latn",
  }).format(new Date(iso));
}
