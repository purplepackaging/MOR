import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getDictionary } from "@/i18n";
import { localePath, type Locale } from "@/lib/i18n";
import { getOrders, getPortal, portalReady } from "@/lib/portal";
import { OrdersTable } from "../parts";
import styles from "../account.module.css";

export async function generateMetadata({ params }: PageProps<"/[locale]/account/orders">): Promise<Metadata> {
  const { locale } = await params;
  return { title: getDictionary(locale as Locale).portal.ordersTitle, robots: { index: false, follow: false } };
}

export default async function OrdersPage({ params }: PageProps<"/[locale]/account/orders">) {
  await connection(); // Always per request: it shows one customer's account.
  const { locale: raw } = await params;
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const p = dict.portal;
  const signInPath = localePath(locale, "/account/sign-in");
  if (!portalReady()) redirect(signInPath);
  const portal = await getPortal();
  if (!portal) redirect(`${signInPath}?next=${encodeURIComponent(localePath(locale, "/account/orders"))}`);
  if (!portal.account) redirect(localePath(locale, "/account"));

  const orders = await getOrders(portal.account.id, 200);

  return (
    <section className={`container ${styles.page}`}>
      <header className={styles.head}>
        <p className={styles.crumb}>
          <Link href={localePath(locale, "/account")}>{p.backToAccount}</Link>
        </p>
        <h1 className="h2">{p.ordersTitle}</h1>
        <p className="muted">{portal.account.name}</p>
      </header>
      {orders.length ? <OrdersTable orders={orders} locale={locale} dict={dict} /> : <p className="muted">{p.noOrders}</p>}
    </section>
  );
}
