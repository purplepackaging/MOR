import type { Metadata } from "next";
import { cookies } from "next/headers";
import { normalizeRepCode, repDisplayName } from "@/config/reps";
import { REP_COOKIE } from "@/config/site";
import { getDictionary } from "@/i18n";
import { localePath, type Locale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/metadata";
import { RequestForm } from "./RequestForm";
import styles from "./request.module.css";

export async function generateMetadata({ params }: PageProps<"/[locale]/request-account">): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  return pageMetadata(locale, "/request-account", { title: dict.request.title, description: dict.request.lede });
}

export default async function RequestAccountPage({ params, searchParams }: PageProps<"/[locale]/request-account">) {
  const { locale: raw } = await params;
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.request;

  // Flyer QR codes go through /r/CODE, which saves the rep in a cookie and in ?rep=.
  const query = await searchParams;
  const fromQuery = typeof query.rep === "string" ? normalizeRepCode(query.rep) : "";
  const fromCookie = normalizeRepCode((await cookies()).get(REP_COOKIE)?.value);
  const repCode = fromQuery || fromCookie;
  const rep = repCode ? { code: repCode, name: repDisplayName(repCode) } : null;

  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.layout}>
        <RequestForm
          locale={locale}
          t={t}
          rep={rep}
          hrefs={{
            list: localePath(locale, "/list"),
            products: localePath(locale, "/products"),
            sms: localePath(locale, "/sms-terms"),
            privacy: localePath(locale, "/privacy"),
          }}
        />
        <aside className={styles.next} aria-labelledby="next-title">
          <h2 id="next-title" className="h3">
            {t.nextTitle}
          </h2>
          <ol role="list" className={styles.steps}>
            {t.next.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
