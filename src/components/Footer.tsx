import Link from "next/link";
import { site } from "@/config/site";
import type { Dict } from "@/i18n";
import { categoryHref } from "@/lib/catalog";
import { htmlLang, languageNames, localePath, locales, switchPath, type Locale } from "@/lib/i18n";
import { getShelfOrAll } from "@/lib/shelf";
import { IntentLink } from "./IntentLink";
import { Wordmark } from "./Wordmark";
import styles from "./Footer.module.css";

export async function Footer({ locale, dict }: { locale: Locale; dict: Dict }) {
  const f = dict.footer;
  // Only categories with something to sell. On every page, so it must never fail one.
  const { categories } = await getShelfOrAll();
  const year = new Date().getFullYear();
  return (
    <footer className={styles.footer}>
      <div className="container">
        <div className={styles.top}>
          <div className={styles.about}>
            <Wordmark className={styles.wordmark} />
            <p>{f.about}</p>
          </div>

          <nav aria-labelledby="footer-shop">
            <h2 id="footer-shop" className={styles.heading}>
              {f.shop}
            </h2>
            <ul role="list" className={styles.links}>
              {categories.map((c) => (
                <li key={c.id}>
                  <IntentLink href={categoryHref(locale, c.id)}>{c.name[locale]}</IntentLink>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-labelledby="footer-company">
            <h2 id="footer-company" className={styles.heading}>
              {f.company}
            </h2>
            <ul role="list" className={styles.links}>
              <li>
                <IntentLink href={`${localePath(locale, "/")}#how`}>{dict.nav.how}</IntentLink>
              </li>
              <li>
                <Link href={localePath(locale, "/request-account")}>{dict.nav.request}</Link>
              </li>
              <li>
                <Link href={localePath(locale, "/account/sign-in")}>{dict.nav.signIn}</Link>
              </li>
              {site.email ? (
                <li>
                  <a href={`mailto:${site.email}`}>{site.email}</a>
                </li>
              ) : null}
            </ul>
          </nav>

          <nav aria-labelledby="footer-legal">
            <h2 id="footer-legal" className={styles.heading}>
              {f.legal}
            </h2>
            <ul role="list" className={styles.links}>
              <li>
                <Link href={localePath(locale, "/privacy")}>{f.privacy}</Link>
              </li>
              <li>
                <Link href={localePath(locale, "/terms")}>{f.terms}</Link>
              </li>
              <li>
                <Link href={localePath(locale, "/sms-terms")}>{f.sms}</Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className={styles.bottom}>
          <p>
            {f.brandOf} © {year} {site.legalName}
          </p>
          <ul role="list" className={styles.langs} aria-label={f.language}>
            {locales.map((l) => (
              <li key={l}>
                <a
                  href={switchPath(l, "/")}
                  hrefLang={htmlLang[l]}
                  lang={htmlLang[l]}
                  aria-current={l === locale ? "true" : undefined}
                >
                  {languageNames[l]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
