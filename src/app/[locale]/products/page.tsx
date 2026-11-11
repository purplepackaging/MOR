import type { Metadata } from "next";
import { ProductBrowser } from "@/components/ProductBrowser";
import { getDictionary } from "@/i18n";
import { localePath, type Locale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/metadata";
import { getShelf } from "@/lib/shelf";
import { browserData } from "./browser-data";
import styles from "./products.module.css";

export async function generateMetadata({ params }: PageProps<"/[locale]/products">): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const dict = getDictionary(locale);
  return pageMetadata(locale, "/products", { title: dict.products.title, description: dict.meta.productsDescription });
}

export default async function ProductsPage({ params }: PageProps<"/[locale]/products">) {
  const locale = (await params).locale as Locale;
  const dict = getDictionary(locale);
  const { items, categories, labels } = browserData(locale, dict, await getShelf());

  return (
    <div className={`container ${styles.page}`}>
      <header className={styles.head}>
        <h1 className="display">{dict.products.title}</h1>
        <p className="lede">{dict.products.lede}</p>
      </header>
      <ProductBrowser
        locale={locale}
        items={items}
        categories={categories}
        allHref={localePath(locale, "/products")}
        labels={labels}
      />
    </div>
  );
}
