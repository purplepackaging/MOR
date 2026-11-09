import "server-only";
import { categories, products, sampleUsualOrder, stapleSlugs } from "@/data/catalog";
import type { Category, CategoryId, IconName, Product, Text, Variant } from "@/data/types";
import type { Dict } from "@/i18n";
import { formatNumber, isolate, localePath, plural, type Locale } from "./i18n";
import { normalize } from "./text";

/* Guard against duplicate SKUs and broken cross-links while building. */
(function validate() {
  const skus = new Set<string>();
  const slugs = new Set(products.map((p) => p.slug));
  for (const p of products) {
    for (const v of p.variants) {
      if (skus.has(v.sku)) throw new Error(`Duplicate SKU ${v.sku}`);
      skus.add(v.sku);
    }
    for (const s of p.goesWith ?? []) {
      if (!slugs.has(s)) throw new Error(`${p.slug} links to missing product ${s}`);
    }
  }
})();

export function txt(value: Text | undefined, locale: Locale): string {
  if (!value) return "";
  return typeof value === "string" ? value : value[locale];
}

export function getCategories(): Category[] {
  return categories;
}

export function getCategory(id: string): Category | undefined {
  return categories.find((c) => c.id === id);
}

export function getProducts(category?: CategoryId): Product[] {
  return category ? products.filter((p) => p.category === category) : products;
}

export function getProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}

export function getStaples(): Product[] {
  return stapleSlugs.map((s) => getProduct(s)).filter((p): p is Product => !!p);
}

export function findVariant(sku: string): { product: Product; variant: Variant } | undefined {
  for (const product of products) {
    const variant = product.variants.find((v) => v.sku === sku);
    if (variant) return { product, variant };
  }
  return undefined;
}

export function productPath(p: Product): string {
  return `/products/${p.category}/${p.slug}`;
}

export function productHref(locale: Locale, p: Product): string {
  return localePath(locale, productPath(p));
}

export function categoryHref(locale: Locale, id: CategoryId): string {
  return localePath(locale, `/products/${id}`);
}

/** "16 oz, Clear" style summary of what makes a variant different. */
export function variantSummary(v: Variant, locale: Locale): string {
  return [txt(v.item, locale), txt(v.size, locale), txt(v.detail, locale), txt(v.color, locale)]
    .filter(Boolean)
    .map((part) => isolate(part, locale))
    .join(locale === "ar" ? "، " : ", ");
}

/** Text for the case column. */
export function packLabel(v: Variant, locale: Locale, dict: Dict): string {
  if (v.packText) return isolate(v.packText, locale);
  if (v.pack == null) return dict.product.askRep;
  const n = formatNumber(locale, v.pack);
  return v.unit ? `${n} ${dict.product.units[v.unit]}` : n;
}

/** "6 sizes" when only the size changes, otherwise "12 options". */
export function optionsLabel(p: Product, locale: Locale, dict: Dict): string {
  const n = p.variants.length;
  const sizes = p.variants.map((v) => txt(v.size, locale));
  const onlySize = sizes.every(Boolean) && new Set(sizes).size === n;
  return plural(locale, n, onlySize ? dict.products.sizes : dict.products.options);
}

export interface Visual {
  image?: string;
  icon?: IconName;
}

export function visualOf(p: { image?: string; icon?: IconName }): Visual {
  return { image: p.image, icon: p.icon };
}

/** Everything the client list needs to show a SKU, in one language. */
export interface SkuInfo {
  name: string;
  summary: string;
  pack: string;
  href: string;
  image?: string;
  icon?: IconName;
}

export function skuIndex(locale: Locale, dict: Dict): Record<string, SkuInfo> {
  const index: Record<string, SkuInfo> = {};
  for (const p of products) {
    for (const v of p.variants) {
      index[v.sku] = {
        name: p.name[locale],
        summary: variantSummary(v, locale),
        pack: packLabel(v, locale, dict),
        href: productHref(locale, p),
        image: p.image,
        icon: p.icon,
      };
    }
  }
  return index;
}

export function sampleOrder(locale: Locale) {
  return sampleUsualOrder
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

export function searchText(p: Product): string {
  const parts: string[] = Object.values(p.name);
  const cat = getCategory(p.category);
  if (cat) parts.push(...Object.values(cat.name));
  for (const v of p.variants) {
    for (const f of [v.item, v.size, v.detail, v.color]) {
      if (!f) continue;
      if (typeof f === "string") parts.push(f);
      else parts.push(...Object.values(f));
    }
  }
  if (p.material) parts.push(...Object.values(p.material));
  return normalize(parts.join(" "));
}
