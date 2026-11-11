import type { Dict } from "@/i18n";
import { localePath, type Locale } from "@/lib/i18n";
import { site } from "@/config/site";
import { Wordmark } from "./Wordmark";
import { AccountLink, CreateAccountLink, LanguageMenu, ListButton, MobileMenu, NavLink } from "./HeaderClient";
import { IntentLink } from "./IntentLink";
import styles from "./Header.module.css";

export function Header({ locale, dict }: { locale: Locale; dict: Dict }) {
  const home = localePath(locale, "/");
  const products = localePath(locale, "/products");
  const how = `${home}#how`;
  const signIn = localePath(locale, "/account/sign-in");
  const request = localePath(locale, "/request-account");
  const account = { href: localePath(locale, "/account"), label: dict.nav.account };

  return (
    <header className={styles.header}>
      <div className={`container ${styles.bar}`}>
        <IntentLink href={home} className={styles.brand} aria-label={dict.nav.home}>
          <Wordmark />
        </IntentLink>

        <nav className={styles.nav} aria-label={dict.nav.primary}>
          <NavLink href={products} className={styles.navLink}>
            {dict.nav.products}
          </NavLink>
          <NavLink href={how} className={styles.navLink} onIntent>
            {dict.nav.how}
          </NavLink>
        </nav>

        <div className={styles.actions}>
          <div className={styles.desktopOnly}>
            <LanguageMenu locale={locale} label={dict.nav.language} />
          </div>
          <AccountLink
            portal={site.portalEnabled}
            signIn={{ href: signIn, label: dict.nav.signIn }}
            account={account}
            className={`${styles.navLink} ${styles.desktopOnly}`}
          />
          <CreateAccountLink
            portal={site.portalEnabled}
            link={{ href: request, label: dict.nav.request }}
            className={`btn btn-sm ${styles.desktopOnly}`}
          />
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
            account={account}
            portal={site.portalEnabled}
            request={{ href: request, label: dict.nav.request }}
          />
        </div>
      </div>
    </header>
  );
}
