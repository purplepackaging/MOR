import "server-only";
import { cache } from "react";
import { categories, products, sampleUsualOrder, stapleSlugs } from "@/data/catalog";
import type { Category, Product } from "@/data/types";
import { getAvailable, getAvailableNow, getAvailableOrAll } from "./availability";
import { findVariant, variantSummary } from "./catalog";
import type { Locale } from "./i18n";

/**
 * The shelf: the part of the catalog that is for sale right now. Every page that
 * shows products reads it, so an item without a price shows nowhere: not in a
 * listing, a search, a product page, the footer, the sitemap or the order list.
 */
export interface Shelf {
  /** Categories with something to sell, in catalog order. */
  categories: Category[];
  /** Products with something to sell. Each lists only the sizes that are for sale. */
  products: Product[];
  /** The home page staples that are for sale. */
  staples: Product[];
  product(slug: string): Product | undefined;
  has(sku: string): boolean;
}

function build(available: ReadonlySet<string> | null): Shelf {
  const onShelf = available
    ? products
        .map((p) => ({ ...p, variants: p.variants.filter((v) => available.has(v.sku)) }))
        .filter((p) => p.variants.length > 0)
    : products;
  const bySlug = new Map(onShelf.map((p) => [p.slug, p]));
  const skus = new Set(onShelf.flatMap((p) => p.variants.map((v) => v.sku)));
  const stocked = new Set(onShelf.map((p) => p.category));
  return {
    categories: categories.filter((c) => stocked.has(c.id)),
    products: onShelf,
    staples: stapleSlugs.map((slug) => bySlug.get(slug)).filter((p): p is Product => !!p),
    product: (slug) => bySlug.get(slug),
    has: (sku) => skus.has(sku),
  };
}

/** Nothing hidden. Built once. */
const everything = build(null);

const shelfOf = (available: ReadonlySet<string> | null) => (available ? build(available) : everything);

/**
 * For pages built ahead of time. Throws when Supabase cannot be reached, which
 * keeps the last good page (see getAvailable).
 */
export const getShelf = cache(async (): Promise<Shelf> => shelfOf(await getAvailable()));

/** For the footer and pages rendered per request: never throws. */
export const getShelfOrAll = cache(async (): Promise<Shelf> => shelfOf(await getAvailableOrAll()));

/** For placing and saving orders: what is for sale at this moment. Never throws. */
export async function getShelfNow(): Promise<Shelf> {
  return shelfOf(await getAvailableNow());
}

/** The sample order on the home page, without lines that are not for sale. */
export function sampleOrder(shelf: Shelf, locale: Locale) {
  return sampleUsualOrder
    .filter(({ sku }) => shelf.has(sku))
    .map(({ sku, cases }) => {
      const found = findVariant(sku);
      if (!found) return null;
      return {
        sku,
        cases,
        name: found.product.name[locale],
        summary: variantSummary(found.variant, locale),
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
}
