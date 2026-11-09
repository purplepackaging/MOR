import Link from "next/link";
import type { Dict } from "@/i18n";
import { localePath, type Locale } from "@/lib/i18n";
import { Wordmark } from "./Wordmark";
import { LanguageMenu, ListButton, MobileMenu, NavLink } from "./HeaderClient";
import styles from "./Header.module.css";

export function Header({ locale, dict }: { locale: Locale; dict: Dict }) {
  const home = localePath(locale, "/");
  const products = localePath(locale, "/products");
  const how = `${home}#how`;
  const signIn = localePath(locale, "/account/sign-in");
  const request = localePath(locale, "/request-account");

  return (
    <header className={styles.header}>
      <div className={`container ${styles.bar}`}>
        <Link href={home} className={styles.brand} aria-label={dict.nav.home}>
          <Wordmark />
        </Link>

        <nav className={styles.nav} aria-label={dict.nav.primary}>
          <NavLink href={products} className={styles.navLink}>
            {dict.nav.products}
          </NavLink>
          <NavLink href={how} className={styles.navLink}>
            {dict.nav.how}
          </NavLink>
        </nav>

        <div className={styles.actions}>
          <div className={styles.desktopOnly}>
            <LanguageMenu locale={locale} label={dict.nav.language} />
          </div>
          <NavLink href={signIn} className={`${styles.navLink} ${styles.desktopOnly}`}>
            {dict.nav.signIn}
          </NavLink>
          <Link href={request} className={`btn btn-sm ${styles.desktopOnly}`}>
            {dict.nav.request}
          </Link>
          <ListButton
            href={localePath(locale, "/list")}
            label={dict.nav.list}
            countForms={dict.nav.listCount}
            locale={locale}
          />
          <MobileMenu
            locale={locale}
            labels={{ menu: dict.nav.menu, close: dict.nav.closeMenu, language: dict.nav.language }}
            links={[
              { href: products, label: dict.nav.products },
              { href: how, label: dict.nav.how },
            ]}
            signIn={{ href: signIn, label: dict.nav.signIn }}
            request={{ href: request, label: dict.nav.request }}
          />
        </div>
      </div>
    </header>
  );
}
