import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { site } from "@/config/site";
import { getDictionary } from "@/i18n";
import { skuIndex } from "@/lib/catalog";
import { fill, formatNumber, localePath, type Locale } from "@/lib/i18n";
import { MAX_CASES } from "@/lib/limits";
import { pageMetadata } from "@/lib/metadata";
import { getFees, getPortal, getPrices, portalReady, setupPath } from "@/lib/portal";
import { getShelfOrAll } from "@/lib/shelf";
import { ListView, type ListPortal, type ListSignIn } from "./ListView";
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

  // Signed-in customers order straight from the list, at their prices.
  // With the portal on, the page renders per request; with it off, it stays static.
  if (site.portalEnabled) await connection();
  let portal: ListPortal | undefined;
  let signIn: ListSignIn | undefined;
  if (portalReady()) {
    const listPath = localePath(locale, "/list");
    const signInHref = `${localePath(locale, "/account/sign-in")}?next=${encodeURIComponent(listPath)}`;
    const session = await getPortal();
    if (session?.account) {
      const [prices, fees] = await Promise.all([getPrices(session.account.id), getFees()]);
      portal = {
        accountName: session.account.name,
        prices,
        fees,
        cardFeePercent: formatNumber(locale, site.cardSurchargePercent),
        ordersHref: localePath(locale, "/account/orders"),
        signInHref,
        signInLabel: dict.nav.signIn,
        noPrice: dict.portal.noPrice,
        lineTotal: dict.portal.lineTotal,
      };
    } else if (session && !session.paused) {
      // Signed in for the first time: set up the business, then come back to this list.
      redirect(setupPath(locale, listPath));
    } else if (!session) {
      signIn = { href: signInHref };
    }
  }

  // Lines for items that are not for sale right now come off the list, with a note.
  const shelf = await getShelfOrAll();

  return (
    <div className={styles.band}>
      <div className={`container ${styles.page}`}>
        <header className={styles.head}>
          <h1 className="h2">{dict.list.title}</h1>
          <p className="lede">{dict.list.lede}</p>
        </header>
        <ListView
          locale={locale}
          index={skuIndex(locale, dict, shelf.products)}
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
            max: fill(d.maxCases, { n: formatNumber(locale, MAX_CASES) }),
          }}
          browseHref={localePath(locale, "/products")}
          requestHref={localePath(locale, "/request-account")}
          portal={portal}
          signIn={signIn}
        />
      </div>
    </div>
  );
}
