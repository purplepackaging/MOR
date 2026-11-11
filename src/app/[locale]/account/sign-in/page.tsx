import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDictionary } from "@/i18n";
import { localePath, type Locale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/metadata";
import { getPortal, portalReady, safeNext } from "@/lib/portal";
import { SignInForm, type SignInMode } from "./SignInForm";
import simple from "../../simple.module.css";
import styles from "../account.module.css";

export async function generateMetadata({ params }: PageProps<"/[locale]/account/sign-in">): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  return {
    ...pageMetadata(locale, "/account/sign-in", { title: dict.signIn.title, description: dict.signIn.soonBody }),
    robots: { index: false, follow: true },
  };
}

/**
 * Customer portal entry point. Signing in takes an email and password, or a code
 * by email (?code=1 opens on that form). Creating an account (?new=1) sends a code
 * to the new email, then they choose a password and set up their business. A
 * signed-in customer changes their password here too (?reset=1), behind a fresh
 * code. While the portal is switched off (NEXT_PUBLIC_PORTAL_ENABLED) or Supabase
 * is not set up, it explains where orders go today. Every link to it across the
 * site stays the same.
 */
export default async function SignInPage({ params, searchParams }: PageProps<"/[locale]/account/sign-in">) {
  const { locale: raw } = await params;
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.signIn;
  const query = await searchParams;
  const next = safeNext(query.next);

  if (!portalReady()) {
    return (
      <section className={`container ${simple.page}`}>
        <div className={simple.panel}>
          <h1 className="h2">{t.soonTitle}</h1>
          <p className="lede">{t.soonBody}</p>
          <div className={simple.actions}>
            <Link className="btn" href={localePath(locale, "/request-account")}>
              {t.request}
            </Link>
            <Link className="btn btn-quiet" href={localePath(locale, "/products")}>
              {t.browse}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const portal = await getPortal();
  const reset = Boolean(portal) && query.reset === "1";
  if (portal && !reset) redirect(next ?? localePath(locale, "/account"));
  const mode: SignInMode = reset ? "reset" : query.new === "1" ? "create" : "signin";
  const here = localePath(locale, "/account/sign-in");

  return (
    <section className={`container ${styles.page}`}>
      <SignInForm
        locale={locale}
        // A password change ends on the account page, which confirms it.
        next={reset ? null : next}
        labels={t}
        optional={dict.request.optional}
        mode={mode}
        // Signed out with ?reset=1: a forgotten password, so open on the code form.
        startWithCode={query.code === "1" || query.reset === "1"}
        knownEmail={reset ? (portal?.user.email ?? null) : null}
        createHref={`${here}?new=1${next ? `&next=${encodeURIComponent(next)}` : ""}`}
        createLabel={dict.nav.request}
      />
    </section>
  );
}
