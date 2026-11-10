import type { Metadata } from "next";
import { connection } from "next/server";
import { site } from "@/config/site";
import { getDictionary } from "@/i18n";
import { skuIndex } from "@/lib/catalog";
import { localePath, type Locale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/metadata";
import { getPortal, getPrices, portalReady } from "@/lib/portal";
import { ListView, type ListPortal } from "./ListView";
import styles from "./list.module.css";

export async function generateMetadata({ params }: PageProps<"/[locale]/list">): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  return {
    ...pageMetadata(locale, "/list", { title: dict.list.title, description: dict.list.lede }),
    robots: { index: false, follow: true },
  };
}

export default async function ListPage({ params }: PageProps<"/[locale]/list">) {
  const { locale: raw } = await params;
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const d = dict.product;

  // Signed-in customers order straight from the list, at their tier's prices.
  // With the portal on, the page renders per request; with it off, it stays static.
  if (site.portalEnabled) await connection();
  let portal: ListPortal | undefined;
  if (portalReady()) {
    const session = await getPortal();
    if (session?.account) {
      portal = {
        accountName: session.account.name,
        prices: await getPrices(session.account.id),
        ordersHref: localePath(locale, "/account/orders"),
        signInHref: `${localePath(locale, "/account/sign-in")}?next=${encodeURIComponent(localePath(locale, "/list"))}`,
        signInLabel: dict.nav.signIn,
        noPrice: dict.portal.noPrice,
      };
    }
  }

  return (
    <div className={styles.band}>
      <div className={`container ${styles.page}`}>
        <header className={styles.head}>
          <h1 className="h2">{dict.list.title}</h1>
          <p className="lede">{dict.list.lede}</p>
        </header>
        <ListView
          locale={locale}
          index={skuIndex(locale, dict)}
          labels={dict.list}
          caseLabel={d.case}
          stepper={{
            add: d.add,
            addTo: d.addTo,
            less: d.less,
            more: d.more,
            casesOf: d.casesOf,
            added: dict.list.added,
            view: dict.list.view,
          }}
          browseHref={localePath(locale, "/products")}
          requestHref={localePath(locale, "/request-account")}
          portal={portal}
        />
      </div>
    </div>
  );
}
