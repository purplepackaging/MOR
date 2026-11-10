import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ToListButton } from "@/components/ToListButton";
import { getDictionary } from "@/i18n";
import { fill, formatDate, formatMoney, formatNumber, localePath, type Locale } from "@/lib/i18n";
import { getOrder, getPortal, portalReady } from "@/lib/portal";
import { StatusPill, describe } from "../../parts";
import styles from "../../account.module.css";

// Order numbers are not known at build time.
export const dynamicParams = true;

export async function generateMetadata({ params }: PageProps<"/[locale]/account/orders/[number]">): Promise<Metadata> {
  const { locale, number } = await params;
  return {
    title: fill(getDictionary(locale as Locale).portal.orderTitle, { n: number }),
    robots: { index: false, follow: false },
  };
}

export default async function OrderPage({ params }: PageProps<"/[locale]/account/orders/[number]">) {
  const { locale: raw, number: rawNumber } = await params;
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const p = dict.portal;
  if (!/^\d{1,12}$/.test(rawNumber)) notFound();
  const signInPath = localePath(locale, "/account/sign-in");
  if (!portalReady()) redirect(signInPath);
  const portal = await getPortal();
  if (!portal) redirect(`${signInPath}?next=${encodeURIComponent(localePath(locale, `/account/orders/${rawNumber}`))}`);
  if (!portal.account) redirect(localePath(locale, "/account"));

  const order = await getOrder(portal.account.id, Number(rawNumber));
  if (!order) notFound();

  const priced = order.lines.some((l) => l.price != null);
  const totalCases = order.lines.reduce((sum, l) => sum + l.cases, 0);

  return (
    <section className={`container ${styles.page}`}>
      <header className={styles.head}>
        <p className={styles.crumb}>
          <Link href={localePath(locale, "/account")}>{p.backToAccount}</Link>
          {" / "}
          <Link href={localePath(locale, "/account/orders")}>{p.allOrdersBack}</Link>
        </p>
        <h1 className="h2" id="order-title">
          {fill(p.orderTitle, { n: order.number })}
        </h1>
        <div className={styles.meta}>
          <StatusPill status={order.status} dict={dict} />
          <p className="muted">
            <bdi>{fill(p.placedOn, { date: formatDate(locale, order.createdAt) })}</bdi>
          </p>
        </div>
        {order.note ? (
          <p className={styles.note}>
            <strong>{p.note}:</strong> {order.note}
          </p>
        ) : null}
      </header>

      {/* Can still scroll sideways with large text, so keyboard users need to be able to focus it. */}
      <div className={styles.tableWrap} role="region" aria-labelledby="order-title" tabIndex={0}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{dict.product.item}</th>
              <th scope="col" className={styles.end}>
                {dict.home.ticketCases}
              </th>
              {priced ? (
                <>
                  <th scope="col" className={`${styles.end} ${styles.wideOnly}`}>
                    {p.price}
                  </th>
                  <th scope="col" className={styles.end}>
                    {p.lineTotal}
                  </th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => {
              const d = describe(l.sku, locale, dict);
              const each = l.price == null ? p.noPrice : <bdi>{formatMoney(locale, l.price)}</bdi>;
              return (
                <tr key={l.sku}>
                  <td>
                    <span className={styles.lineName}>{d.name}</span>
                    <span className={styles.lineMeta}>{d.summary}</span>
                    {priced ? (
                      <span className={`${styles.lineMeta} ${styles.narrowOnly}`}>
                        {l.price == null ? p.noPrice : <bdi>{fill(dict.list.perCase, { price: formatMoney(locale, l.price) })}</bdi>}
                      </span>
                    ) : null}
                  </td>
                  <td className={styles.end}>{formatNumber(locale, l.cases)}</td>
                  {priced ? (
                    <>
                      <td className={`${styles.end} ${styles.wideOnly}`}>{each}</td>
                      <td className={styles.end}>
                        {l.price == null ? "" : <bdi>{formatMoney(locale, l.price * l.cases)}</bdi>}
                      </td>
                    </>
                  ) : null}
                </tr>
              );
            })}
            <tr className={styles.totalRow}>
              <td>{p.subtotal}</td>
              <td className={styles.end}>{formatNumber(locale, totalCases)}</td>
              {priced ? (
                <>
                  <td className={styles.wideOnly} />
                  <td className={styles.end}>
                    {order.subtotal == null ? p.noPrice : <bdi>{formatMoney(locale, order.subtotal)}</bdi>}
                  </td>
                </>
              ) : null}
            </tr>
          </tbody>
        </table>
      </div>
      {order.subtotal == null ? <p className="small muted">{priced ? dict.list.needsPrice : dict.list.pricesSoon}</p> : null}

      <div className={`${styles.row} ${styles.footer}`}>
        <ToListButton
          lines={order.lines.map(({ sku, cases }) => ({ sku, cases }))}
          label={p.reorder}
          done={p.reordered}
          href={localePath(locale, "/list")}
        />
      </div>
    </section>
  );
}
