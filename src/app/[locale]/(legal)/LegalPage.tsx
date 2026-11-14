import type { Metadata } from "next";
import { getDictionary } from "@/i18n";
import { fill, htmlLang, type Locale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/metadata";
import styles from "./legal.module.css";

/** Date the legal pages last changed. Update it with every edit. */
export const LEGAL_UPDATED = "2026-11-13";

export type LegalKey = "privacy" | "terms" | "sms";

const paths: Record<LegalKey, string> = { privacy: "/privacy", terms: "/terms", sms: "/sms-terms" };

export function legalMetadata(locale: Locale, key: LegalKey): Metadata {
  const dict = getDictionary(locale);
  return pageMetadata(locale, paths[key], { title: dict.footer[key] });
}

/**
 * Legal text is written and reviewed in English only. Other languages get a
 * translated title and a note, with the English text marked lang="en".
 */
export function LegalPage({ locale, page, children }: { locale: Locale; page: LegalKey; children: React.ReactNode }) {
  const dict = getDictionary(locale);
  const updated = new Intl.DateTimeFormat(htmlLang[locale], {
    dateStyle: "long",
    numberingSystem: "latn",
    timeZone: "UTC",
  }).format(new Date(`${LEGAL_UPDATED}T12:00:00Z`));

  return (
    <article className={`container ${styles.page}`}>
      <header className={styles.head}>
        <h1 className="h2">{dict.footer[page]}</h1>
        <p className="muted small">{fill(dict.legal.updated, { date: updated })}</p>
        {locale !== "en" ? <p className={styles.note}>{dict.legal.englishOnly}</p> : null}
      </header>
      <div className={styles.body} lang="en" dir="ltr">
        {children}
      </div>
    </article>
  );
}

/** How to reach us, from the business settings. Falls back to the rep. */
export function ContactUs({ site }: { site: { email: string | null; phone: string | null; legalName: string } }) {
  const phone = site.phone ? site.phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") : null;
  return (
    <p>
      {site.email || phone ? (
        <>
          Contact {site.legalName}
          {site.email ? (
            <>
              {" "}
              at <a href={`mailto:${site.email}`}>{site.email}</a>
            </>
          ) : null}
          {phone ? (
            <>
              {site.email ? " or" : ""} by phone or text at <a href={`tel:${site.phone}`}>{phone}</a>
            </>
          ) : null}
          .
        </>
      ) : (
        <>Contact your MOR Supply sales rep, or reply HELP to any text from us.</>
      )}
    </p>
  );
}
