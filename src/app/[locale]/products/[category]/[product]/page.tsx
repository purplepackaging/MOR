import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Leaf } from "lucide-react";
import { AddToList, type StepperLabels } from "@/components/AddToList";
import { ProductCard } from "@/components/ProductCard";
import { ProductVisual } from "@/components/ProductVisual";
import { site } from "@/config/site";
import { getDictionary } from "@/i18n";
import {
  allProducts,
  categoryHref,
  getCategory,
  optionsLabel,
  packLabel,
  productHref,
  productPath,
  txt,
  variantSummary,
} from "@/lib/catalog";
import { fill, formatNumber, isolate, localePath, type Locale } from "@/lib/i18n";
import { MAX_CASES } from "@/lib/limits";
import { pageMetadata } from "@/lib/metadata";
import { getShelf } from "@/lib/shelf";
import { Price, PriceHead, PricingNote } from "./Prices";
import styles from "./product.module.css";

export const dynamicParams = false;

// Every product gets a page, so one that gets a price later needs no new deploy.
// A product with nothing to sell right now answers "not found".
export function generateStaticParams() {
  return allProducts().map((p) => ({ category: p.category, product: p.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/products/[category]/[product]">): Promise<Metadata> {
  const { locale: raw, product: slug } = await params;
  const locale = raw as Locale;
  const p = (await getShelf()).product(slug);
  if (!p) return {};
  const dict = getDictionary(locale);
  return pageMetadata(locale, productPath(p), {
    title: p.name[locale],
    description: `${p.name[locale]}: ${optionsLabel(p, locale, dict)}. ${dict.product.soldByCase}.`,
  });
}

type Column = "item" | "size" | "detail" | "color" | "fits";
const COLUMNS: Column[] = ["item", "size", "detail", "color", "fits"];

export default async function ProductPage({ params }: PageProps<"/[locale]/products/[category]/[product]">) {
  const { locale: raw, category, product: slug } = await params;
  const locale = raw as Locale;
  // Only the sizes that are for sale; a product with none is not found.
  const shelf = await getShelf();
  const p = shelf.product(slug);
  if (!p || p.category !== category) notFound();
  const dict = getDictionary(locale);
  const d = dict.product;
  const cat = getCategory(p.category)!;
  const columns = COLUMNS.filter((c) => p.variants.some((v) => v[c]));
  const listHref = localePath(locale, "/list");
  const labels: StepperLabels = {
    add: d.add,
    addTo: d.addTo,
    less: d.less,
    more: d.more,
    casesOf: d.casesOf,
    added: dict.list.added,
    view: dict.list.view,
    max: fill(d.maxCases, { n: formatNumber(locale, MAX_CASES) }),
  };
  // The page is static. A signed-in customer's prices load after it, from /api/prices.
  const prices = site.portalEnabled;
  const priceLabels = { locale, label: dict.portal.price, noPrice: dict.portal.noPrice };
  const related = (p.goesWith ?? []).map((s) => shelf.product(s)).filter((x) => !!x).slice(0, 4);

  return (
    <div className={`container ${styles.page}`}>
      <nav aria-label={d.breadcrumb} className={styles.crumbs}>
        <ol role="list">
          <li>
            <Link href={localePath(locale, "/products")}>{dict.products.title}</Link>
          </li>
          <li>
            <Link href={categoryHref(locale, p.category)}>{cat.name[locale]}</Link>
          </li>
        </ol>
      </nav>

      <div className={styles.layout}>
        <div className={styles.media}>
          <ProductVisual image={p.image} icon={p.icon} alt={p.name[locale]} className={styles.tile} priority sizes={720} />
        </div>

        <div className={styles.info}>
          <h1 className={`h2 ${styles.title}`}>{p.name[locale]}</h1>

          <ul role="list" className={styles.facts}>
            {p.material ? (
              <li>
                <span className="visually-hidden">{d.material}: </span>
                {p.material[locale]}
              </li>
            ) : null}
            <li>{d.soldByCase}</li>
            {(p.tags ?? []).map((tag) => (
              <li key={tag} className={styles.tag}>
                {d.tags[tag]}
              </li>
            ))}
            {p.plantBased ? (
              <li className={`${styles.tag} ${styles.plant}`}>
                <Leaf aria-hidden="true" />
                {dict.products.plantBased}
              </li>
            ) : null}
          </ul>

          <table className={styles.table}>
            <caption className="visually-hidden">{p.name[locale]}</caption>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c} scope="col">
                    {d[c]}
                  </th>
                ))}
                <th scope="col">{d.case}</th>
                <PriceHead enabled={prices} label={dict.portal.price} />
                <th scope="col">
                  <span className="visually-hidden">{d.order}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {p.variants.map((v) => {
                const name = `${p.name[locale]}, ${variantSummary(v, locale)}`.replace(/, $/, "");
                // On phones the extra columns collapse into one line under the first.
                const compact = columns
                  .slice(1)
                  .map((c) => {
                    const value = txt(v[c], locale);
                    return value && c === "fits" ? `${d.fits}: ${isolate(value, locale)}` : isolate(value, locale);
                  })
                  .filter(Boolean)
                  .join(locale === "ar" ? "، " : ", ");
                return (
                  <tr key={v.sku}>
                    {columns.map((c, i) => (
                      <td key={c} className={i === 0 ? styles.primary : styles.extra}>
                        <bdi>{txt(v[c], locale) || "–"}</bdi>
                      </td>
                    ))}
                    {compact ? <td className={styles.compact}>{compact}</td> : null}
                    <td className={`num ${styles.caseCell}`}>
                      <span className={styles.pack} data-label={d.case}>
                        <bdi>{packLabel(v, locale, dict)}</bdi>
                      </span>
                      <Price enabled={prices} sku={v.sku} {...priceLabels} inline />
                    </td>
                    <Price enabled={prices} sku={v.sku} {...priceLabels} />
                    <td className={styles.addCell}>
                      <AddToList sku={v.sku} name={name} labels={labels} listHref={listHref} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <PricingNote enabled={prices} soon={dict.list.pricesSoon}>
            {d.pricing}{" "}
            <Link className="link" href={localePath(locale, "/request-account")}>
              {d.pricingCta}
            </Link>
          </PricingNote>
        </div>
      </div>

      {related.length ? (
        <section className={styles.related} aria-labelledby="goes-with">
          <h2 id="goes-with" className="h3">
            {d.goesWith}
          </h2>
          <ul role="list" className={styles.relatedGrid}>
            {related.map((r) => (
              <li key={r!.slug}>
                <ProductCard
                  card={{
                    slug: r!.slug,
                    href: productHref(locale, r!),
                    name: r!.name[locale],
                    meta: optionsLabel(r!, locale, dict),
                    image: r!.image,
                    icon: r!.icon,
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
