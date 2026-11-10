import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
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
 * True for a real page load (a typed URL, a plain link, the language switcher).
 * Next's router prefetches links in the background, and those fetches can land
 * after the visitor has already switched language. Next strips its own router
 * headers before the proxy runs, so this reads the browser's Fetch Metadata.
 */
function isPageLoad(request: NextRequest) {
  const dest = request.headers.get("sec-fetch-dest");
  if (dest) return dest === "document";
  // Browsers without Fetch Metadata: page loads ask for HTML, router fetches ask for */*.
  return (request.headers.get("accept") ?? "").includes("text/html");
}

/** Portal pages that read the customer's session: /account/... and /list, in any language. */
const SESSION_PATH = /^\/(?:(?:es|tr|ar)\/)?(?:account(?:\/.*)?|list)$/;

type Finish = (res: NextResponse) => NextResponse;

/**
 * Refreshes the customer's Supabase session before the page renders, so Server
 * Components always see a valid sign-in. Returns a function that copies any
 * refreshed cookies (and no-cache headers) onto the final response.
 */
async function refreshSession(request: NextRequest): Promise<Finish> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (process.env.NEXT_PUBLIC_PORTAL_ENABLED !== "true" || !url || !key) return (res) => res;

  const pending: { name: string; value: string; options: CookieOptions }[] = [];
  let noCache: Record<string, string> = {};
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        pending.push(...toSet);
        noCache = headers;
      },
    },
  });
  try {
    await supabase.auth.getUser();
  } catch (error) {
    console.error("[proxy] session refresh failed:", error);
  }
  return (res) => {
    for (const { name, value, options } of pending) res.cookies.set(name, value, options);
    for (const [k, v] of Object.entries(noCache)) res.headers.set(k, v);
    return res;
  };
}

/**
 * English lives at the root (/products). Spanish, Turkish and Arabic live
 * under a prefix (/es/products). A first visit picks the browser language;
 * after that the language switcher's choice is remembered in a cookie.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const first = pathname.split("/")[1];

  if (isLocale(first) && first === defaultLocale) {
    // /en/... is only used by the language switcher: remember English, drop the prefix.
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(3) || "/";
    const res = NextResponse.redirect(url);
    return isPageLoad(request) ? remember(res, defaultLocale) : res;
  }

  const saved = request.cookies.get(LOCALE_COOKIE)?.value;
  const visitor = isLocale(saved) ? saved : (fromAcceptLanguage(request.headers.get("accept-language")) ?? defaultLocale);

  if (!isLocale(first) && visitor !== defaultLocale) {
    const url = request.nextUrl.clone();
    url.pathname = `/${visitor}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(url);
  }

  const portalPage = SESSION_PATH.test(pathname);
  const finish = portalPage ? await refreshSession(request) : (res: NextResponse) => res;
  // Portal pages pass the refreshed session cookies through to the page render.
  const forward = portalPage ? { request: { headers: request.headers } } : undefined;

  if (isLocale(first)) {
    const res = finish(NextResponse.next(forward));
    return saved === first || !isPageLoad(request) ? res : remember(res, first);
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${defaultLocale}${pathname === "/" ? "" : pathname}`;
  return finish(NextResponse.rewrite(url, forward));
}

export const config = {
  matcher: ["/((?!_next/|api/|r/|.*\\..*).*)"],
};
