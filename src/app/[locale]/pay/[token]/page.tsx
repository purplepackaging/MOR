import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { site } from "@/config/site";
import { getDictionary, type Dict } from "@/i18n";
import { findVariant, variantSummary } from "@/lib/catalog";
import { fill, formatDate, formatMoney, formatNumber, isolate, plural, type Locale } from "@/lib/i18n";
import { paymentSentences } from "@/lib/payment-text";
import { getPayOrder, isPayToken, payState, type PayOrder, type PayState } from "@/lib/payments";
import { paymentsReady, publicStripe, toCents } from "@/lib/stripe";
import { PayForm } from "./PayForm";
import styles from "./pay.module.css";

/**
 * The pay link: /pay/<token>, sent to the customer when the order arrives. Whoever holds it
 * sees what the order holds and comes to, and pays by bank or card without signing in.
 * Rendered for each visit; it does not exist while the site takes no payments.
 */

// Tokens are not known at build time.
export const dynamicParams = true;

/** Once per request: the title and the page read the same order. */
const loadOrder = cache(async (token: string): Promise<PayOrder | null | "error"> => {
  try {
    return await getPayOrder(token);
  } catch (error) {
    console.error("[pay] could not read the order behind a pay link:", error);
    return "error";
  }
});

/** "Pay for order 1001", or "Pay for order" when the order is not known. */
const titleFor = (dict: Dict, n: number | null) => fill(dict.pay.title, { n: n ?? "" }).replace(/\s+/g, " ").trim();

export async function generateMetadata({ params }: PageProps<"/[locale]/pay/[token]">): Promise<Metadata> {
  const { locale, token } = await params;
  const dict = getDictionary(locale as Locale);
  const order = paymentsReady() && isPayToken(token) ? await loadOrder(token) : null;
  return {
    title: titleFor(dict, order && order !== "error" ? order.number : null),
    robots: { index: false, follow: false },
  };
}

export default async function PayPage({ params }: PageProps<"/[locale]/pay/[token]">) {
  await connection();
  const { locale: raw, token } = await params;
  const locale = raw as Locale;
  const stripe = publicStripe();
  if (!paymentsReady() || !stripe || !isPayToken(token)) notFound();
  const dict = getDictionary(locale);
  const pay = dict.pay;
  const p = dict.portal;

  const order = await loadOrder(token);
  if (order === "error") {
    return (
      <section className={`container ${styles.page}`}>
        <h1 className="h2">{titleFor(dict, null)}</h1>
        <p className={styles.problem} role="alert">
          {pay.loadError}
        </p>
      </section>
    );
  }
  if (!order) notFound();
  const state = payState(order);
  const due = order.amountDue;
  const pct = formatNumber(locale, site.cardSurchargePercent);

  return (
    <section className={`container ${styles.page}`}>
      <header className={styles.head}>
        <h1 className="h2">{titleFor(dict, order.number)}</h1>
        <p className="muted">
          <bdi>{order.accountName}</bdi>
          <span aria-hidden="true"> · </span>
          <bdi>{fill(p.placedOn, { date: formatDate(locale, order.createdAt) })}</bdi>
        </p>
      </header>

      <div className={styles.layout}>
        <section className={styles.box} aria-labelledby="pay-box-title">
          {state === "open" && due != null ? (
            <PayForm
              locale={locale}
              token={order.token}
              publishableKey={stripe.publishableKey}
              testMode={stripe.mode === "test"}
              dueCents={toCents(due)}
              lastFailed={order.payment.status === "failed"}
              titleId="pay-box-title"
              labels={{
                amountDue: pay.amountDue,
                failed: pay.failed,
                howTitle: pay.howTitle,
                feeNote: fill(dict.list.cardFee, { pct }),
                review: pay.review,
                checking: pay.checking,
                checkTitle: pay.checkTitle,
                orderTotal: pay.orderTotal,
                cardFee: fill(pay.cardFee, { pct }),
                youPay: pay.youPay,
                payButton: pay.payButton,
                paying: pay.paying,
                change: pay.change,
                paidTitle: pay.paidTitle,
                paidLabel: pay.paidLabel,
                processingTitle: pay.processingTitle,
                processingBody: pay.processingBody,
                declined: pay.declined,
                error: pay.error,
                changed: pay.changed,
                expired: pay.expired,
                loadFailed: pay.loadFailed,
                testMode: pay.testMode,
              }}
            />
          ) : (
            <Settled order={order} state={state} locale={locale} dict={dict} />
          )}
        </section>

        <section className={styles.items} aria-labelledby="pay-items">
          <h2 className="h3" id="pay-items">
            {pay.items}
          </h2>
          <ul className={styles.lines}>
            {order.lines.map((l) => {
              const found = findVariant(l.sku);
              return (
                <li key={l.sku}>
                  <span className={styles.lineName}>{found ? found.product.name[locale] : isolate(l.sku, locale)}</span>
                  <span className={styles.lineMeta}>
                    {found ? variantSummary(found.variant, locale) : p.removedItem}
                    {" · "}
                    {plural(locale, l.cases, dict.list.cases)}
                  </span>
                  <span className={styles.lineEnd}>
                    {l.price == null ? p.noPrice : <bdi>{formatMoney(locale, Math.round(l.price * 100 * l.cases) / 100)}</bdi>}
                  </span>
                </li>
              );
            })}
          </ul>
          <dl className={styles.costs}>
            <div>
              <dt>{p.subtotal}</dt>
              <dd>{order.subtotal == null ? p.noPrice : <bdi>{formatMoney(locale, order.subtotal)}</bdi>}</dd>
            </div>
            {order.deliveryFee != null ? (
              <div>
                <dt>{p.delivery}</dt>
                <dd>{order.deliveryFee === 0 ? dict.list.free : <bdi>{formatMoney(locale, order.deliveryFee)}</bdi>}</dd>
              </div>
            ) : null}
            {order.nextDay && order.nextDayFee != null ? (
              <div>
                <dt>{p.nextDay}</dt>
                <dd>{order.nextDayFee === 0 ? dict.list.free : <bdi>{formatMoney(locale, order.nextDayFee)}</bdi>}</dd>
              </div>
            ) : null}
            <div className={styles.costsTotal}>
              <dt>{p.total}</dt>
              <dd>{due == null ? p.noPrice : <bdi>{formatMoney(locale, due)}</bdi>}</dd>
            </div>
          </dl>
        </section>
      </div>
    </section>
  );
}

/** An order that cannot be paid now: paid, a bank payment on its way, canceled, or no total yet. */
function Settled({ order, state, locale, dict }: { order: PayOrder; state: PayState; locale: Locale; dict: Dict }) {
  const pay = dict.pay;
  const title = state === "paid" ? pay.paidTitle : state === "processing" ? pay.processingTitle : dict.portal.paymentTitle;
  const sentences =
    state === "paid" || state === "processing"
      ? paymentSentences(order.payment, locale, dict)
      : [state === "canceled" ? fill(pay.canceled, { n: order.number }) : pay.noTotal];
  return (
    <div className={styles.settled} data-state={state}>
      <h2 className="h3" id="pay-box-title">
        {title}
      </h2>
      {sentences.map((sentence) => (
        <p key={sentence}>{sentence}</p>
      ))}
    </div>
  );
}
