import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ToListButton } from "@/components/ToListButton";
import { getDictionary } from "@/i18n";
import { fill, formatDate, formatMoney, formatNumber, localePath, type Locale } from "@/lib/i18n";
import { paymentSentences } from "@/lib/payment-text";
import { payPath } from "@/lib/payments";
import { getOrder, getPortal, orderAmount, portalReady } from "@/lib/portal";
import { getShelfOrAll } from "@/lib/shelf";
import { paymentsReady } from "@/lib/stripe";
import { StatusPill, describe } from "../../parts";
import { CancelOrder } from "./CancelOrder";
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

export default async function OrderPage({ params, searchParams }: PageProps<"/[locale]/account/orders/[number]">) {
  const { locale: raw, number: rawNumber } = await params;
  const { canceled: canceledNote, late: lateNote, paid: paidNote } = await searchParams;
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const p = dict.portal;
  if (!/^\d{1,12}$/.test(rawNumber)) notFound();
  const signInPath = localePath(locale, "/account/sign-in");
  if (!portalReady()) redirect(signInPath);
  const portal = await getPortal();
  if (!portal) redirect(`${signInPath}?next=${encodeURIComponent(localePath(locale, `/account/orders/${rawNumber}`))}`);
  if (!portal.account) redirect(localePath(locale, "/account"));

  const [order, shelf] = await Promise.all([getOrder(portal.account.id, Number(rawNumber)), getShelfOrAll()]);
  if (!order) notFound();
  // Ordering these again puts only what is for sale on the list. The rest is marked below.
  const forSale = order.lines.filter((l) => shelf.has(l.sku)).map(({ sku, cases }) => ({ sku, cases }));

  const priced = order.lines.some((l) => l.price != null);
  const totalCases = order.lines.reduce((sum, l) => sum + l.cases, 0);

  // Payment: what happened to it, and a way to pay while the site takes payments.
  const payment = order.payment;
  const amount = orderAmount(order);
  const canPay =
    paymentsReady() &&
    order.status !== "canceled" &&
    (payment.status === "unpaid" || payment.status === "failed") &&
    amount != null &&
    amount >= 0.5;
  const paymentText = paymentSentences(payment, locale, dict);
  if (canPay && payment.status === "unpaid") paymentText.push(p.unpaid);
  // Paid, or a bank payment is on its way: canceling would need a refund, which the team makes.
  const paying = payment.status === "paid" || payment.status === "processing";

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
          {order.nextDay ? <p className={styles.nextDay}>{p.nextDay}</p> : null}
        </div>
        {/* What just happened to this order, said once, in the page. */}
        {canceledNote && order.status === "canceled" ? (
          <p className={styles.notice} role="status">
            {fill(p.canceledNote, { n: order.number })}
          </p>
        ) : paidNote && paying && order.status !== "canceled" ? (
          <p className={`${styles.notice} ${styles.noticeProblem}`} role="status">
            {p.cancelPaid}
          </p>
        ) : lateNote && order.status !== "received" && order.status !== "canceled" ? (
          <p className={`${styles.notice} ${styles.noticeProblem}`} role="status">
            {p.cancelTooLate}
          </p>
        ) : null}
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
              const d = describe(l.sku, locale, dict, shelf);
              const each = l.price == null ? p.noPrice : <bdi>{formatMoney(locale, l.price)}</bdi>;
              return (
                <tr key={l.sku}>
                  <td>
                    <span className={styles.lineName}>{d.name}</span>
                    <span className={styles.lineMeta}>{d.summary}</span>
                    {d.note ? <span className={styles.lineMeta}>{d.note}</span> : null}
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
      {order.deliveryFee != null ? (
        <dl className={styles.costs}>
          <div>
            <dt>{p.delivery}</dt>
            <dd>{order.deliveryFee === 0 ? dict.list.free : <bdi>{formatMoney(locale, order.deliveryFee)}</bdi>}</dd>
          </div>
          {order.nextDay && order.nextDayFee != null ? (
            <div>
              <dt>{p.nextDay}</dt>
              <dd>{order.nextDayFee === 0 ? dict.list.free : <bdi>{formatMoney(locale, order.nextDayFee)}</bdi>}</dd>
            </div>
          ) : null}
          <div className={styles.costsTotal}>
            <dt>{p.total}</dt>
            <dd>{order.total == null ? p.noPrice : <bdi>{formatMoney(locale, order.total)}</bdi>}</dd>
          </div>
        </dl>
      ) : null}
      {order.subtotal == null ? <p className="small muted">{priced ? dict.list.needsPrice : dict.list.pricesSoon}</p> : null}

      {paymentText.length || canPay ? (
        <section className={styles.payment} aria-labelledby="payment-title">
          <h2 className="h3" id="payment-title">
            {p.paymentTitle}
          </h2>
          {paymentText.map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
          {canPay ? (
            <Link className="btn" href={payPath(locale, order.payToken)} prefetch={false}>
              {p.payNow}
            </Link>
          ) : null}
        </section>
      ) : null}

      {forSale.length ? (
        <div className={`${styles.row} ${styles.footer}`}>
          <ToListButton lines={forSale} label={p.reorder} done={p.reordered} href={localePath(locale, "/list")} />
        </div>
      ) : null}

      {/* Until the team confirms it, and until it is paid, the customer can still call the order off. */}
      {order.status === "received" && !paying ? (
        <CancelOrder
          locale={locale}
          number={order.number}
          labels={{
            cancel: p.cancelOrder,
            hint: p.cancelHint,
            ask: fill(p.cancelAsk, { n: order.number }),
            yes: p.cancelYes,
            no: p.cancelNo,
            canceling: p.canceling,
            failed: p.cancelFailed,
          }}
        />
      ) : null}
    </section>
  );
}
