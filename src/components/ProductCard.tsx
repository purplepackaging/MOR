import type { IconName } from "@/data/types";
import { CardPrice, type CardPriceLabels } from "./CardPrice";
import { IntentLink } from "./IntentLink";
import { ProductVisual } from "./ProductVisual";
import styles from "./ProductCard.module.css";

export interface CardData {
  slug: string;
  href: string;
  name: string;
  /** What it comes in: "5 sizes: 9, 10, 12, 16, 24 oz", "13 options". */
  meta: string;
  image?: string;
  icon?: IconName;
  plantBased?: boolean;
  plantLabel?: string;
  /** The sizes for sale, so a signed-in customer's price can show on the card. */
  skus?: string[];
}

/**
 * A product in a listing. On phones it is a line, like a line on the order ticket: a small photo, then the
 * name and what it comes in. From 640 px up it is a card, with the photo over the name.
 */
export function ProductCard({
  card,
  headingLevel = 3,
  prices,
}: {
  card: CardData;
  headingLevel?: 2 | 3;
  /** Pass it while the portal is on. Signed-out visitors still see no price. */
  prices?: CardPriceLabels;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <IntentLink href={card.href} className={styles.card}>
      <ProductVisual image={card.image} icon={card.icon} className={styles.tile} />
      <div className={styles.body}>
        <H className={styles.name}>{card.name}</H>
        <p className={styles.meta}>
          {card.meta}
          {card.plantBased && card.plantLabel ? <span className={styles.plant}>{card.plantLabel}</span> : null}
        </p>
        {/* The price's line is there for everyone, empty until a customer's price arrives, so nothing moves. */}
        {prices && card.skus?.length ? (
          <p className={styles.slot}>
            <CardPrice skus={card.skus} labels={prices} />
          </p>
        ) : null}
      </div>
    </IntentLink>
  );
}
