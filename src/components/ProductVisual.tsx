import type { IconName } from "@/data/types";
import { ProductIcon } from "./ProductIcon";

interface Props {
  image?: string;
  icon?: IconName;
  /** Accessible name. Leave empty when the product name is already next to it. */
  alt?: string;
  className?: string;
  priority?: boolean;
  /**
   * How wide the photo is drawn, as a CSS `sizes` value. The browser picks the file from it,
   * so say the real size: a phone with a sharp screen would otherwise fetch the large file for a card.
   */
  sizes?: string;
}

/** A card: two to a row on a phone, three or four on wider screens. */
export const CARD_PHOTO = "(max-width: 639px) 37vw, 230px";

/** A product photo or drawing on a lilac tile. */
export function ProductVisual({ image, icon, alt = "", className, priority, sizes = CARD_PHOTO }: Props) {
  return (
    <div className={`tile ${className ?? ""}`}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/img/products/${image}.webp`}
          // Every photo comes in two files: 480 px on its long side for cards and lists, and up to 1000 px
          // for the product page. The tile is square and the photo fits inside it, so the long side is what counts.
          srcSet={`/img/products/${image}-480.webp 480w, /img/products/${image}.webp 1000w`}
          sizes={sizes}
          alt={alt}
          width={480}
          height={480}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : undefined}
        />
      ) : icon ? (
        <>
          <ProductIcon name={icon} />
          {alt ? <span className="visually-hidden">{alt}</span> : null}
        </>
      ) : null}
    </div>
  );
}
