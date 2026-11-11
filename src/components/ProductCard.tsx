import type { IconName } from "@/data/types";
import { CardPrice, type CardPriceLabels } from "./CardPrice";
import { IntentLink } from "./IntentLink";
import { ProductVisual } from "./ProductVisual";
import styles from "./ProductCard.module.css";

export interface CardData {
  slug: string;
  href: string;
  name: string;
  meta: string;
  image?: string;
  icon?: IconName;
  plantBased?: boolean;
  plantLabel?: string;
  /** The sizes for sale, so a signed-in customer's price can show on the card. */
  skus?: string[];
}

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
      <div className={styles.visual}>
        <ProductVisual image={card.image} icon={card.icon} className={styles.tile} sizes={320} />
        {prices && card.skus?.length ? <CardPrice skus={card.skus} labels={prices} /> : null}
      </div>
      <div className={styles.body}>
        <H className={styles.name}>{card.name}</H>
        <p className={styles.meta}>
          {card.meta}
          {card.plantBased && card.plantLabel ? <span className={styles.plant}>{card.plantLabel}</span> : null}
        </p>
      </div>
    </IntentLink>
  );
}
