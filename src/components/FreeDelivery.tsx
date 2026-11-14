import { formatMoney, type Locale } from "@/lib/i18n";
import styles from "./FreeDelivery.module.css";

/**
 * How far an order is from free delivery: what is left to add, with a bar that fills as the order grows,
 * then "You get free delivery." once it reaches the threshold. It keeps its place either way, so nothing
 * below it moves when the order crosses the line.
 *
 * `panel` sits under the totals (the list's summary, the order guide's card). `bar` is a line at the top of
 * the list's order bar on phones, and its track runs along the bar's top edge.
 *
 * Reading only: the amounts come from `leftForFree` (src/lib/delivery.ts), and screen readers hear them
 * through the list's own spoken summary, so this says nothing by itself.
 */
export function FreeDelivery({
  locale,
  subtotal,
  freeFrom,
  left,
  labels,
  variant = "panel",
}: {
  locale: Locale;
  subtotal: number;
  freeFrom: number;
  /** What is left to add for free delivery; 0 once the order gets it. */
  left: number;
  /** `left` holds "{amount}". */
  labels: { left: string; reached: string };
  variant?: "panel" | "bar";
}) {
  const reached = left <= 0;
  const share = reached ? 100 : Math.min(100, Math.max(0, (subtotal / freeFrom) * 100));
  const [before, after] = labels.left.split("{amount}");
  return (
    <div
      className={`${styles.note} ${variant === "bar" ? styles.bar : styles.panel}`}
      data-free-delivery={reached ? "reached" : "left"}
    >
      <p className={styles.text}>
        {reached ? (
          labels.reached
        ) : (
          <>
            {before}
            <strong className={styles.amount}>
              <bdi>{formatMoney(locale, left)}</bdi>
            </strong>
            {after}
          </>
        )}
      </p>
      <span className={styles.track} aria-hidden="true">
        <span className={styles.fill} style={{ inlineSize: `${share.toFixed(1)}%` }} />
      </span>
    </div>
  );
}
