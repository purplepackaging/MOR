import "server-only";
import type { BrowserCategory, BrowserItem } from "@/components/ProductBrowser";
import type { Dict } from "@/i18n";
import { categoryHref, getCategories, getProducts, optionsLabel, productHref, searchText } from "@/lib/catalog";
import type { Locale } from "@/lib/i18n";

export function browserData(locale: Locale, dict: Dict) {
  const items: BrowserItem[] = getProducts().map((p) => ({
    slug: p.slug,
    href: productHref(locale, p),
    name: p.name[locale],
    meta: optionsLabel(p, locale, dict),
    image: p.image,
    icon: p.icon,
    plantBased: p.plantBased,
    plantLabel: dict.products.plantBased,
    category: p.category,
    search: searchText(p),
  }));
  const categories: BrowserCategory[] = getCategories().map((c) => ({
    id: c.id,
    name: c.name[locale],
    href: categoryHref(locale, c.id),
  }));
  const p = dict.products;
  const labels = {
    searchLabel: p.searchLabel,
    searchPlaceholder: p.searchPlaceholder,
    clearSearch: p.clearSearch,
    all: p.all,
    categoriesLabel: p.categoriesLabel,
    plantBased: p.plantBased,
    results: p.results,
    noResults: p.noResults,
    noResultsHint: p.noResultsHint,
  };
  return { items, categories, labels };
}
