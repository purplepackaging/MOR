import "server-only";
import type { BrowserCategory, BrowserItem } from "@/components/ProductBrowser";
import type { Dict } from "@/i18n";
import { cardPriceLabels, categoryHref, productCard, searchText } from "@/lib/catalog";
import type { Locale } from "@/lib/i18n";
import type { Shelf } from "@/lib/shelf";

/** What the product browser shows: only what is on the shelf. */
export function browserData(locale: Locale, dict: Dict, shelf: Shelf) {
  const items: BrowserItem[] = shelf.products.map((p) => ({
    ...productCard(p, locale, dict),
    plantBased: p.plantBased,
    plantLabel: dict.products.plantBased,
    category: p.category,
    search: searchText(p),
  }));
  const categories: BrowserCategory[] = shelf.categories.map((c) => ({
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
  return { items, categories, labels, prices: cardPriceLabels(locale, dict) };
}
