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

/** A card: a 96 px photo beside the name on a phone, three or four cards to a row on wider screens. */
export const CARD_PHOTO = "(max-width: 639px) 96px, 230px";

/**
 * Browsers keep a photo for a day, and may show their old copy once more after that (the cache rule for
 * /img in next.config.ts). When a photo is replaced under the same name, raise this number: the address
 * changes, so every browser fetches the new file on its next visit.
 */
export const PHOTO_VERSION = 3;

/** A product photo or drawing on a lilac tile. */
export function ProductVisual({ image, icon, alt = "", className, priority, sizes = CARD_PHOTO }: Props) {
  const file = (size: "" | "-480") => `/img/products/${image}${size}.webp?v=${PHOTO_VERSION}`;
  return (
    <div className={`tile ${className ?? ""}`}>
      {image ? (
        // The shadow is drawn on this layer, which covers the whole tile, and not on the photo itself:
        // Safari cuts a shadow off at the edge of its own image, which showed as straight lines on iPhones.
        <span className="shot">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={file("")}
            // Every photo comes in two files: 480 px on its long side for cards and lists, and up to 1000 px
            // for the product page. The tile is square and the photo fits inside it, so the long side is what counts.
            srcSet={`${file("-480")} 480w, ${file("")} 1000w`}
            sizes={sizes}
            alt={alt}
            width={480}
            height={480}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={priority ? "high" : undefined}
          />
        </span>
      ) : icon ? (
        <>
          <ProductIcon name={icon} />
          {alt ? <span className="visually-hidden">{alt}</span> : null}
        </>
      ) : null}
    </div>
  );
}
