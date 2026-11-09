import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, defaultLocale, isLocale, type Locale } from "@/lib/i18n";

const ONE_YEAR = 60 * 60 * 24 * 365;

function fromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { base: tag.toLowerCase().split("-")[0], q: q ? Number.parseFloat(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { base } of ranked) if (isLocale(base)) return base;
  return null;
}

function remember(res: NextResponse, locale: Locale) {
  res.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
  return res;
}

/**
 * English lives at the root (/products). Spanish, Turkish and Arabic live
 * under a prefix (/es/products). A first visit picks the browser language;
 * after that the language switcher's choice is remembered in a cookie.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const first = pathname.split("/")[1];

  if (isLocale(first)) {
    if (first === defaultLocale) {
      // /en/... is only used by the language switcher: remember English, drop the prefix.
      const url = request.nextUrl.clone();
      url.pathname = pathname.slice(3) || "/";
      return remember(NextResponse.redirect(url), defaultLocale);
    }
    const res = NextResponse.next();
    return request.cookies.get(LOCALE_COOKIE)?.value === first ? res : remember(res, first);
  }

  const saved = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(saved) ? saved : (fromAcceptLanguage(request.headers.get("accept-language")) ?? defaultLocale);
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;

  return locale === defaultLocale ? NextResponse.rewrite(url) : NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/|api/|r/|.*\\..*).*)"],
};
