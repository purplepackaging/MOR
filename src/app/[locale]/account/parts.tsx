import Link from "next/link";
import type { Dict } from "@/i18n";
import { findVariant, variantSummary } from "@/lib/catalog";
import { fill, formatDate, formatMoney, formatNumber, isolate, localePath, type Locale } from "@/lib/i18n";
import { orderAmount, type OrderSummary } from "@/lib/portal";
import type { Shelf } from "@/lib/shelf";
import styles from "./account.module.css";

/**
 * Product name and option summary for a SKU, or a plain note when it left the catalog.
 * `note` says so when the item is in the catalog but not for sale right now.
 */
export function describe(sku: string, locale: Locale, dict: Dict, shelf: Shelf) {
  const found = findVariant(sku);
  if (!found) return { name: isolate(sku, locale), summary: dict.portal.removedItem, note: null };
  return {
    name: found.product.name[locale],
    summary: variantSummary(found.variant, locale),
    note: shelf.has(sku) ? null : dict.portal.unavailable,
  };
}

export function StatusPill({ status, dict }: { status: OrderSummary["status"]; dict: Dict }) {
  return (
    <span className={styles.pill} data-status={status}>
      {dict.portal.status[status]}
    </span>
  );
}

export function OrdersTable({ orders, locale, dict }: { orders: OrderSummary[]; locale: Locale; dict: Dict }) {
  const p = dict.portal;
  return (
    // Can still scroll sideways with large text, so keyboard users need to be able to focus it.
    <div className={styles.tableWrap} role="region" aria-label={p.ordersTitle} tabIndex={0}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{p.order}</th>
            <th scope="col" className={styles.wideOnly}>
              {p.date}
            </th>
            <th scope="col">{p.statusLabel}</th>
            <th scope="col" className={`${styles.end} ${styles.wideOnly}`}>
              {dict.home.ticketCases}
            </th>
            <th scope="col" className={styles.end}>
              {p.total}
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const cases = o.lines.reduce((sum, l) => sum + l.cases, 0);
            const date = formatDate(locale, o.createdAt);
            const amount = orderAmount(o);
            return (
              <tr key={o.id}>
                <td>
                  <Link
                    href={localePath(locale, `/account/orders/${o.number}`)}
                    aria-label={fill(p.orderLink, { n: o.number, date })}
                  >
                    <bdi>{o.number}</bdi>
                  </Link>
                  <span className={`${styles.lineMeta} ${styles.narrowOnly} ${styles.nowrap}`}>
                    <bdi>{date}</bdi>
                  </span>
                </td>
                <td className={styles.wideOnly}>
                  <bdi>{date}</bdi>
                </td>
                <td>
                  <StatusPill status={o.status} dict={dict} />
                </td>
                <td className={`${styles.end} ${styles.wideOnly}`}>{formatNumber(locale, cases)}</td>
                <td className={styles.end}>{amount == null ? p.noPrice : <bdi>{formatMoney(locale, amount)}</bdi>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
