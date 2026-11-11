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

/**
 * "$1,234.50" with Latin digits in every language. Arabic uses the English layout:
 * its own ("1,234.50 US$") puts the dollar sign on the wrong side of "US" once it
 * sits in right-to-left text. It is also kept together as one left-to-right unit
 * (invisible LRI…PDI marks); without them the "$" moves to the other side of the
 * digits whenever Arabic words come before it in the sentence.
 */
export function formatMoney(locale: Locale, amount: number): string {
  const money = new Intl.NumberFormat(htmlLang[locale === "ar" ? "en" : locale], {
    style: "currency",
    currency: "USD",
    numberingSystem: "latn",
  }).format(amount);
  return locale === "ar" ? `\u2066${money}\u2069` : money;
}

/** "Nov 10, 2026" in the reader's language, on Atlanta time. */
export function formatDate(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(htmlLang[locale], {
    dateStyle: "medium",
    timeZone: "America/New_York",
    numberingSystem: "latn",
  }).format(new Date(iso));
}
