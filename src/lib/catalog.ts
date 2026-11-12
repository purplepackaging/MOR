import "server-only";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CardPriceLabels } from "@/components/CardPrice";
import type { CardData } from "@/components/ProductCard";
import { site } from "@/config/site";
import { categories, products } from "@/data/catalog";
import { searchWords } from "@/data/search-words";
import type { Category, CategoryId, IconName, Product, Text, Variant } from "@/data/types";
import type { Dict } from "@/i18n";
import { formatNumber, isolate, localePath, plural, type Locale } from "./i18n";
import { normalize } from "./text";

/* Guard against duplicate SKUs, broken cross-links, search words for no product and missing photo files while building. */
(function validate() {
  const skus = new Set<string>();
  const slugs = new Set(products.map((p) => p.slug));
  // The photo folder is only there while the site is being built, so that is when it is checked.
  const photos = process.env.NEXT_PHASE === "phase-production-build" ? join(process.cwd(), "public/img/products") : null;
  for (const p of [...products, ...categories]) {
    if (!photos || !p.image) continue;
    for (const file of [`${p.image}.webp`, `${p.image}-480.webp`]) {
      if (!existsSync(join(photos, file))) throw new Error(`Photo file missing: public/img/products/${file}`);
    }
  }
  for (const p of products) {
    for (const v of p.variants) {
      if (skus.has(v.sku)) throw new Error(`Duplicate SKU ${v.sku}`);
      skus.add(v.sku);
    }
    for (const s of p.goesWith ?? []) {
      if (!slugs.has(s)) throw new Error(`${p.slug} links to missing product ${s}`);
    }
  }
  for (const slug of Object.keys(searchWords)) {
    if (!slugs.has(slug)) throw new Error(`Search words for missing product ${slug}`);
  }
})();

export function txt(value: Text | undefined, locale: Locale): string {
  if (!value) return "";
  return typeof value === "string" ? value : value[locale];
}

/*
 * The whole catalog, including items that are not for sale right now. Pages that
 * show products read src/lib/shelf.ts instead, which leaves those out. Use these
 * only to name the pages to build, and to name SKUs on past orders and in emails.
 */

export function allCategories(): Category[] {
  return categories;
}

export function allProducts(): Product[] {
  return products;
}

export function getCategory(id: string): Category | undefined {
  return categories.find((c) => c.id === id);
}

/** Any SKU the catalog has ever listed, for sale or not. */
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

/** Text for the case column: "1,000", or "6 boxes" and "1 roll" when the case holds counted units. */
export function packLabel(v: Variant, locale: Locale, dict: Dict): string {
  if (v.packText) return isolate(v.packText, locale);
  if (v.pack == null) return dict.product.askRep;
  return v.unit ? plural(locale, v.pack, dict.product.units[v.unit]) : formatNumber(locale, v.pack);
}

/** True when every row for sale has its own size, so the rows are "sizes" and not "options". */
function sizesOnly(p: Product, locale: Locale): boolean {
  const sizes = p.variants.map((v) => txt(v.size, locale));
  return sizes.every(Boolean) && new Set(sizes).size === p.variants.length;
}

/** "6 sizes" when only the size changes, otherwise "12 options". */
export function optionsLabel(p: Product, locale: Locale, dict: Dict): string {
  return plural(locale, p.variants.length, sizesOnly(p, locale) ? dict.products.sizes : dict.products.options);
}

/** A number and its unit, the way the catalog writes one size: "16 oz", "5.5 oz", "98 mm". */
function measure(text: Text | undefined): { n: number; unit: string } | null {
  if (typeof text !== "string") return null;
  const m = /^(\d+(?:\.\d+)?) ([A-Za-z]+)$/.exec(text.trim());
  return m ? { n: Number(m[1]), unit: m[2] } : null;
}

/**
 * "9–24 oz" when the sizes for sale run along one measure, and the size itself when every row shares it.
 * Empty when sizes cannot be put in a row: boxes measured three ways, towels and tissue under one product.
 * Give it a product from the shelf. Only what the catalog says, no rounding and no words.
 */
export function sizeRange(p: Product, locale: Locale): string {
  const sizes = p.variants.map((v) => v.size).filter((s): s is Text => !!s);
  if (!sizes.length) return "";
  const said = new Set(sizes.map((s) => txt(s, locale)));
  // One size for every row. "1/6" alone (a bag size) says little; a measure such as "9 in" or "15 × 17 in" does.
  if (said.size === 1) {
    const only = [...said][0];
    return sizes.length === p.variants.length && /\d\s?[a-z]/i.test(only) ? isolate(only, locale) : "";
  }
  const measured = sizes.map(measure);
  // Most rows carry a size (a sleeve among cups does not), and they all use one unit.
  if (measured.some((m) => !m) || sizes.length < p.variants.length * 0.6) return "";
  const unit = measured[0]!.unit;
  if (measured.some((m) => m!.unit !== unit)) return "";
  const ns = measured.map((m) => m!.n);
  // A no-break space: the unit never drops to the next line without its number.
  return isolate(`${Math.min(...ns)}–${Math.max(...ns)}\u00A0${unit}`, locale);
}

/** How many sizes a card names one by one. More than this and it gives the range instead. */
const SIZES_NAMED = 6;
/** Sizes that are letters go small to large, whatever order the catalog lists them in. */
const LETTER_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

/**
 * What tells the rows apart, said once each, when every row for sale has one and they are few and short:
 * "S, M, L, XL" for gloves, "Fork, Knife, Teaspoon, Soup spoon" for cutlery. Empty otherwise.
 */
function fewValues(p: Product, column: "size" | "item", locale: Locale): string {
  if (!p.variants.every((v) => v[column])) return "";
  const values = [...new Set(p.variants.map((v) => txt(v[column], locale)))];
  if (values.length < 2 || values.length > 4 || values.join(", ").length > 34) return "";
  if (values.every((v) => LETTER_SIZES.includes(v))) values.sort((a, b) => LETTER_SIZES.indexOf(a) - LETTER_SIZES.indexOf(b));
  return values.map((v) => isolate(v, locale)).join(locale === "ar" ? "، " : ", ");
}

/**
 * The sizes for sale, for a card: "9, 10, 12, 16, 24 oz" while they are few, then the range ("12–58 oz").
 * Where sizes are not one measure: the few sizes or items by name, or nothing.
 */
export function sizeList(p: Product, locale: Locale): string {
  const range = sizeRange(p, locale);
  // Items are named only under "options": "15 sizes: Flat bag, Bottle bag" would call an item a size.
  if (!range) return fewValues(p, "size", locale) || (sizesOnly(p, locale) ? "" : fewValues(p, "item", locale));
  const measured = p.variants.map((v) => measure(v.size)).filter((m) => m !== null);
  const ns = [...new Set(measured.map((m) => m.n))].sort((a, b) => a - b);
  if (ns.length < 2 || ns.length > SIZES_NAMED) return range;
  return isolate(`${ns.join(", ")}\u00A0${measured[0].unit}`, locale);
}

/** One line under a product's name: "5 sizes: 9, 10, 12, 16, 24 oz", "13 options", or the one size it comes in. */
export function productDetail(p: Product, locale: Locale, dict: Dict): string {
  const sizes = sizeList(p, locale);
  if (p.variants.length === 1) return sizes || optionsLabel(p, locale, dict);
  return [optionsLabel(p, locale, dict), sizes].filter(Boolean).join(": ");
}

/** True for a cup that names the lid it takes: a size in oz and "fits" in mm, as in "16 oz, 98 mm". */
export function namesItsLid(v: Variant): boolean {
  return measure(v.size)?.unit === "oz" && measure(v.fits)?.unit === "mm";
}

/** What a "fits" covers: "12–24 oz", "9 oz" or "24, 32, 40 oz". Null when it has words ("squat cups") or is missing. */
function fitSpan(text: Text | undefined): { unit: string; has: (n: number) => boolean } | null {
  if (typeof text !== "string") return null;
  const m = /^([\d.,\s–-]+) ([A-Za-z]+)$/.exec(text.trim());
  if (!m) return null;
  const range = /^(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)$/.exec(m[1].trim());
  if (range) return { unit: m[2], has: (n) => n >= Number(range[1]) && n <= Number(range[2]) };
  const list = m[1].split(",").map((s) => s.trim());
  if (!list.every((s) => /^\d+(?:\.\d+)?$/.test(s))) return null;
  return { unit: m[2], has: (n) => list.map(Number).includes(n) };
}

/** Does `a` say it fits `b`'s size? true, false, or null when `a` says nothing that can be checked against it. */
function covers(a: Variant, b: Variant): { fits: boolean; unit: string } | null {
  const span = fitSpan(a.fits);
  const size = measure(b.size);
  return span && size && span.unit === size.unit ? { fits: span.has(size.n), unit: span.unit } : null;
}

export interface FitGroup {
  product: Product;
  /** The sizes of that product that fit a size on this page. */
  variants: Variant[];
}

/**
 * The sizes of each "goes with" product that fit a size of `p`, going only by what the catalog says.
 * A lid that "fits 12–24 oz" fits the 16 oz cup. Where both sides also give a rim in mm (cup "98 mm",
 * lid "98 mm") the two must agree, and a rim on its own proves nothing (a sleeve "fits 90 mm" cups, not
 * 90 mm lids). A fit written in words is left out. Give it products from the shelf.
 */
export function fitsFor(p: Product, related: Product[]): FitGroup[] {
  const groups: FitGroup[] = [];
  for (const r of related) {
    const variants = r.variants.filter((b) =>
      p.variants.some((a) => {
        const said = [covers(a, b), covers(b, a)].filter((c) => c !== null);
        return said.every((c) => c.fits) && said.some((c) => c.unit !== "mm");
      }),
    );
    if (variants.length) groups.push({ product: r, variants });
  }
  return groups;
}

/** What a product card shows. Give it a product from the shelf, so it counts only the sizes for sale. */
export function productCard(p: Product, locale: Locale, dict: Dict): CardData {
  return {
    slug: p.slug,
    href: productHref(locale, p),
    name: p.name[locale],
    meta: productDetail(p, locale, dict),
    image: p.image,
    icon: p.icon,
    skus: p.variants.map((v) => v.sku),
  };
}

/** The words for a customer's price on product cards, while the portal is on. */
export function cardPriceLabels(locale: Locale, dict: Dict): CardPriceLabels | undefined {
  if (!site.portalEnabled) return undefined;
  return { locale, from: dict.portal.fromPrice, fromSpoken: dict.portal.fromPriceSpoken, perCase: dict.list.perCase };
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
  /** What a case holds: a count ("1,000", "150 sets"), or "Ask your rep" when the catalog has none. */
  pack: string;
  /** True when `pack` is a count, so the list can write "1,000 per case". */
  counted: boolean;
  href: string;
  image?: string;
  icon?: IconName;
}

export function skuIndex(locale: Locale, dict: Dict, products: Product[]): Record<string, SkuInfo> {
  const index: Record<string, SkuInfo> = {};
  for (const p of products) {
    for (const v of p.variants) {
      index[v.sku] = {
        name: p.name[locale],
        summary: variantSummary(v, locale),
        pack: packLabel(v, locale, dict),
        counted: v.packText != null || v.pack != null,
        href: productHref(locale, p),
        image: p.image,
        icon: p.icon,
      };
    }
  }
  return index;
}

/** Everything search reads for one product: its names, category, sizes, material and its search words. */
export function searchText(p: Product): string {
  const parts: string[] = [...Object.values(p.name), ...(searchWords[p.slug] ?? [])];
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
