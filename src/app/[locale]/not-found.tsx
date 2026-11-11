import Link from "next/link";
import { locale as rootLocale } from "next/root-params";
import { IntentLink } from "@/components/IntentLink";
import { getDictionary } from "@/i18n";
import { isLocale, localePath, type Locale } from "@/lib/i18n";
import styles from "./simple.module.css";

export default async function NotFound() {
  const raw = await rootLocale();
  const locale: Locale = isLocale(raw) ? raw : "en";
  const dict = getDictionary(locale);
  return (
    <section className={`container ${styles.page}`}>
      <div className={styles.panel}>
        <h1 className="h2">{dict.notFound.title}</h1>
        <p className="lede">{dict.notFound.body}</p>
        <div className={styles.actions}>
          <Link className="btn" href={localePath(locale, "/products")}>
            {dict.notFound.products}
          </Link>
          <IntentLink className="btn btn-quiet" href={localePath(locale, "/")}>
            {dict.notFound.home}
          </IntentLink>
        </div>
      </div>
    </section>
  );
}
