import type { Metadata } from "next";
import Link from "next/link";
import { getDictionary } from "@/i18n";
import { localePath, type Locale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/metadata";
import styles from "../../simple.module.css";

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
 * Customer portal entry point. Until the portal ships (NEXT_PUBLIC_PORTAL_ENABLED),
 * this explains where orders go today. The portal replaces this page with the
 * sign-in form; every link to it across the site stays the same.
 */
export default async function SignInPage({ params }: PageProps<"/[locale]/account/sign-in">) {
  const { locale: raw } = await params;
  const locale = raw as Locale;
  const t = getDictionary(locale).signIn;

  return (
    <section className={`container ${styles.page}`}>
      <div className={styles.panel}>
        <h1 className="h2">{t.soonTitle}</h1>
        <p className="lede">{t.soonBody}</p>
        <div className={styles.actions}>
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
