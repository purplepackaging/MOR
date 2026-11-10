import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDictionary } from "@/i18n";
import { localePath, type Locale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/metadata";
import { getPortal, portalReady, safeNext } from "@/lib/portal";
import { SignInForm } from "./SignInForm";
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
 * Customer portal entry point, for signing in and for creating an account: a new
 * email gets a code too, then sets up its business. While the portal is switched
 * off (NEXT_PUBLIC_PORTAL_ENABLED) or Supabase is not set up, it explains where
 * orders go today. Every link to it across the site stays the same.
 */
export default async function SignInPage({ params, searchParams }: PageProps<"/[locale]/account/sign-in">) {
  const { locale: raw } = await params;
  const locale = raw as Locale;
  const t = getDictionary(locale).signIn;
  const query = await searchParams;
  const next = safeNext(query.next);
  const create = query.new === "1";

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

  if (await getPortal()) redirect(next ?? localePath(locale, "/account"));

  return (
    <section className={`container ${styles.page}`}>
      <SignInForm locale={locale} next={next} labels={t} create={create} />
    </section>
  );
}
