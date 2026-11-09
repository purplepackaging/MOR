import type { IconName } from "@/data/types";
import { ProductIcon } from "./ProductIcon";

interface Props {
  image?: string;
  icon?: IconName;
  /** Accessible name. Leave empty when the product name is already next to it. */
  alt?: string;
  className?: string;
  priority?: boolean;
  /** Rendered size hint for the browser. */
  sizes?: number;
}

/** A product photo or drawing on a lilac tile. */
export function ProductVisual({ image, icon, alt = "", className, priority, sizes = 360 }: Props) {
  return (
    <div className={`tile ${className ?? ""}`}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/img/products/${image}.webp`}
          alt={alt}
          width={sizes}
          height={sizes}
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
