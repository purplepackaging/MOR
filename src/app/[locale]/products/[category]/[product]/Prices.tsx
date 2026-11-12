"use client";

import type { ReactNode } from "react";
import { formatMoney, type Locale } from "@/lib/i18n";
import { usePrices } from "@/lib/price-store";
import styles from "./product.module.css";

/** Heading of the price column. Only there while this customer's prices are showing. */
export function PriceHead({ enabled, label }: { enabled: boolean; label: string }) {
  const { status } = usePrices(enabled);
  if (status !== "ok") return null;
  return (
    <th scope="col" className={styles.priceHead}>
      {label}
    </th>
  );
}

/**
 * Price per case for one size. A table cell on wide screens; on phones (`inline`)
 * it sits at the end of the case line, so rows keep their height when prices arrive.
 */
export function Price({
  enabled,
  sku,
  locale,
  label,
  noPrice,
  inline = false,
}: {
  enabled: boolean;
  sku: string;
  locale: Locale;
  label: string;
  noPrice: string;
  inline?: boolean;
}) {
  const { status, prices } = usePrices(enabled);
  if (status !== "ok" || !prices) return null;
  const price = prices[sku];
  const value =
    price == null ? <span className={styles.noPrice}>{noPrice}</span> : <bdi>{formatMoney(locale, price)}</bdi>;
  if (!inline) return <td className={styles.priceCell}>{value}</td>;
  return (
    <span className={styles.priceInline}>
      <span className="visually-hidden">{label}: </span>
      {value}
    </span>
  );
}

/**
 * The note under the sizes. Signed-out visitors keep "Prices show after you sign in";
 * customers whose prices are showing, or whose account is switched off, see nothing.
 * For them the note keeps its place, unseen: the page is built with it, and taking it
 * out would pull everything under it ("Goes with" and its Add buttons) up as the session answers.
 */
export function PricingNote({ enabled, soon, children }: { enabled: boolean; soon: string; children: ReactNode }) {
  const { status } = usePrices(enabled);
  const gone = status === "ok" || status === "paused";
  return (
    <p className={`${styles.pricing} ${gone ? styles.pricingGone : ""}`} aria-hidden={gone || undefined}>
      {status === "soon" ? soon : children}
    </p>
  );
}
