import type { Locale } from "@/lib/i18n";

/** A string in every site language. */
export type L10n = Record<Locale, string>;

/** Universal text (sizes like "16 oz") or localized text. */
export type Text = string | L10n;

export type CategoryId =
  | "cups-lids"
  | "containers"
  | "foil-wrap"
  | "plates-bowls"
  | "cutlery-straws"
  | "bags"
  | "napkins-paper"
  | "gloves-safety"
  | "cleaning";

export type PackUnit = "sets" | "kits" | "rolls" | "boxes" | "pairs";

export type IconName =
  | "hotCup"
  | "hotLid"
  | "foilRoll"
  | "foilSheets"
  | "film"
  | "waxPaper"
  | "straw"
  | "glove"
  | "cap"
  | "apron"
  | "jug"
  | "pump";

export type TagId = "microwave" | "pfasFree" | "compostable" | "wrapped" | "antiFog";

export interface Variant {
  /** MOR stock number. Stable: orders and standing orders reference it. */
  sku: string;
  item?: L10n;
  size?: Text;
  detail?: L10n;
  color?: L10n;
  /** What it fits, e.g. "12–24 oz" for lids. Translate it when it has words. */
  fits?: Text;
  /** Units per case. null = confirm with the rep. */
  pack: number | null;
  unit?: PackUnit;
  /** Overrides the case column, e.g. "6 × 1 gal". */
  packText?: string;
}

export interface Product {
  slug: string;
  category: CategoryId;
  name: L10n;
  /** File name (no extension) in /public/products. */
  image?: string;
  /** Drawn illustration when there is no photo yet. */
  icon?: IconName;
  material?: L10n;
  tags?: TagId[];
  plantBased?: boolean;
  goesWith?: string[];
  variants: Variant[];
}

export interface Category {
  id: CategoryId;
  name: L10n;
  description: L10n;
  image?: string;
  icon?: IconName;
}
