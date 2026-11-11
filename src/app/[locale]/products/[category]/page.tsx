import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductBrowser } from "@/components/ProductBrowser";
import type { CategoryId } from "@/data/types";
import { getDictionary } from "@/i18n";
import { allCategories, allProducts } from "@/lib/catalog";
import { localePath, type Locale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/metadata";
import { getShelf } from "@/lib/shelf";
import { browserData } from "../browser-data";
import styles from "../products.module.css";

export const dynamicParams = false;

// Every category gets a page, so one that fills up later needs no new deploy.
// A category with nothing to sell right now answers "not found".
export function generateStaticParams() {
  return allCategories().map((c) => ({ category: c.id }));
}

export async function generateMetadata({ params }: PageProps<"/[locale]/products/[category]">): Promise<Metadata> {
  const { locale: raw, category } = await params;
  const locale = raw as Locale;
  const c = (await getShelf()).categories.find((x) => x.id === category);
  if (!c) return {};
  return pageMetadata(locale, `/products/${c.id}`, { title: c.name[locale], description: c.description[locale] });
}

export default async function CategoryPage({ params }: PageProps<"/[locale]/products/[category]">) {
  const { locale: raw, category } = await params;
  const locale = raw as Locale;
  const shelf = await getShelf();
  const c = shelf.categories.find((x) => x.id === category);
  if (!c) notFound();
  const dict = getDictionary(locale);
  const { items, categories, labels } = browserData(locale, dict, shelf);
  // The category's own line names its products. While some of them are hidden, say the general line instead.
  const inCategory = (list: { category: string }[]) => list.filter((p) => p.category === c.id).length;
  const complete = inCategory(shelf.products) === inCategory(allProducts());

  return (
    <div className={`container ${styles.page}`}>
      <header className={styles.head}>
        <h1 className="display">{c.name[locale]}</h1>
        <p className="lede">{complete ? c.description[locale] : dict.products.lede}</p>
      </header>
      <ProductBrowser
        locale={locale}
        items={items}
        categories={categories}
        current={c.id as CategoryId}
        allHref={localePath(locale, "/products")}
        labels={labels}
      />
    </div>
  );
}
