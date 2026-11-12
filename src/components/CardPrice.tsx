"use client";

import { fill, formatMoney, type Locale } from "@/lib/i18n";
import { usePrices } from "@/lib/price-store";
import styles from "./ProductCard.module.css";

/** What a card needs to show a signed-in customer's price. The words come from the dictionary. */
export interface CardPriceLabels {
  locale: Locale;
  /** "From {price}", shown when sizes cost different amounts. */
  from: string;
  /** "From {price} a case", for screen readers. */
  fromSpoken: string;
  /** "{price} a case", for screen readers when every size costs the same. */
  perCase: string;
}

/**
 * A signed-in customer's price on a product card: the lowest price per case among
 * the product's sizes. The prices come from the database through /api/prices; this
 * only picks which one to show. It sits on the card's last line, which is there for
 * everyone, so the card keeps its height when the price arrives after the page.
 */
export function CardPrice({ skus, labels }: { skus: string[]; labels: CardPriceLabels }) {
  const { status, prices } = usePrices(true);
  if (status !== "ok" || !prices) return null;
  const known = skus.map((sku) => prices[sku]).filter((p): p is number => p != null);
  if (known.length === 0) return null;
  const lowest = Math.min(...known);
  const money = formatMoney(labels.locale, lowest);
  // "From" unless every size has a price and they are all the same.
  const same = known.length === skus.length && known.every((p) => p === lowest);
  return (
    <span className={styles.price}>
      <bdi aria-hidden="true">{same ? money : fill(labels.from, { price: money })}</bdi>
      <span className="visually-hidden">{fill(same ? labels.perCase : labels.fromSpoken, { price: money })}</span>
    </span>
  );
}
