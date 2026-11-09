import Link from "next/link";
import type { IconName } from "@/data/types";
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
}

export function ProductCard({ card, headingLevel = 3 }: { card: CardData; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <Link href={card.href} className={styles.card}>
      <ProductVisual image={card.image} icon={card.icon} className={styles.tile} sizes={320} />
      <div className={styles.body}>
        <H className={styles.name}>{card.name}</H>
        <p className={styles.meta}>
          {card.meta}
          {card.plantBased && card.plantLabel ? <span className={styles.plant}>{card.plantLabel}</span> : null}
        </p>
      </div>
    </Link>
  );
}
