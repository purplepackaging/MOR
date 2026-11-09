import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductBrowser } from "@/components/ProductBrowser";
import type { CategoryId } from "@/data/types";
import { getDictionary } from "@/i18n";
import { getCategories, getCategory } from "@/lib/catalog";
import { localePath, type Locale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/metadata";
import { browserData } from "../browser-data";
import styles from "../products.module.css";

export const dynamicParams = false;

export function generateStaticParams() {
  return getCategories().map((c) => ({ category: c.id }));
}

export async function generateMetadata({ params }: PageProps<"/[locale]/products/[category]">): Promise<Metadata> {
  const { locale: raw, category } = await params;
  const locale = raw as Locale;
  const c = getCategory(category);
  if (!c) return {};
  return pageMetadata(locale, `/products/${c.id}`, { title: c.name[locale], description: c.description[locale] });
}

export default async function CategoryPage({ params }: PageProps<"/[locale]/products/[category]">) {
  const { locale: raw, category } = await params;
  const locale = raw as Locale;
  const c = getCategory(category);
  if (!c) notFound();
  const dict = getDictionary(locale);
  const { items, categories, labels } = browserData(locale, dict);

  return (
    <div className={`container ${styles.page}`}>
      <header className={styles.head}>
        <h1 className="display">{c.name[locale]}</h1>
        <p className="lede">{c.description[locale]}</p>
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
