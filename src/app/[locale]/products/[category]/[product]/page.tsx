import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Leaf } from "lucide-react";
import { AddToList, type StepperLabels } from "@/components/AddToList";
import { IntentLink } from "@/components/IntentLink";
import { ListBar } from "@/components/ListBar";
import { ProductVisual } from "@/components/ProductVisual";
import { site } from "@/config/site";
import type { Product, Variant } from "@/data/types";
import { getDictionary, type Dict } from "@/i18n";
import {
  allProducts,
  categoryHref,
  fitsFor,
  getCategory,
  namesItsLid,
  optionsLabel,
  packLabel,
  productDetail,
  productHref,
  productPath,
  sizeRange,
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
  const dict = getDictionary(locale);
  // Nothing to sell right now: the page is the not-found page, so it takes that page's title.
  if (!p) return { title: dict.notFound.title };
  return pageMetadata(locale, productPath(p), {
    title: p.name[locale],
    description: `${p.name[locale]}: ${optionsLabel(p, locale, dict)}. ${dict.product.soldByCase}.`,
  });
}

type Column = "item" | "size" | "detail" | "color" | "fits";
const COLUMNS: Column[] = ["item", "size", "detail", "color", "fits"];

/** A long list in a few colors gets a color filter above it. */
const FILTER_FROM_ROWS = 7;
const FILTER_MAX_COLORS = 5;
/** How many sizes of a "goes with" product show under it. Its name links to the rest. */
const FIT_ROWS = 4;

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
  const comma = locale === "ar" ? "، " : ", ";
  const present = COLUMNS.filter((c) => p.variants.some((v) => v[c]));
  // A column that reads the same on every row is a fact about the product, not a choice between sizes:
  // it moves up beside the material, as long as a column is left to tell the rows apart.
  const first = p.variants[0];
  const shared =
    p.variants.length > 1
      ? present.filter((c) => txt(first[c], locale) && p.variants.every((v) => txt(v[c], locale) === txt(first[c], locale)))
      : [];
  const columns = shared.length < present.length ? present.filter((c) => !shared.includes(c)) : present;
  const sharedFacts = columns === present ? [] : shared;
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
  const table = { locale, dict, labels, listHref, prices };

  // What the product is, in the catalog's own words: the material, then how far the sizes run.
  const summary = [p.material?.[locale], sizeRange(p, locale)].filter(Boolean).join(comma);
  const pills = sharedFacts.length + (p.tags?.length ?? 0) + (p.plantBased ? 1 : 0);

  // A long list in a few colors: one tap leaves only that color. Rows with no color (a sleeve among cups) stay.
  const colors = columns.includes("color") ? [...new Set(p.variants.map((v) => txt(v.color, locale)).filter(Boolean))] : [];
  const filter = p.variants.length >= FILTER_FROM_ROWS && colors.length >= 2 && colors.length <= FILTER_MAX_COLORS ? colors : [];

  // "Goes with": each product by name. Where the catalog says which of its sizes fit this one,
  // those sizes follow, each with an Add button.
  const related = (p.goesWith ?? []).map((s) => shelf.product(s)).filter((x): x is Product => !!x);
  const fits = fitsFor(p, related);
  const others = related.filter((r) => !fits.some((g) => g.product.slug === r.slug)).slice(0, 4);
  const relatedHead = (r: Product, ruled: boolean) => (
    <IntentLink href={productHref(locale, r)} className={`${styles.fitHead} ${ruled ? styles.ruled : ""}`}>
      <ProductVisual image={r.image} icon={r.icon} className={styles.fitTile} sizes="64px" />
      <span className={styles.fitName}>
        <span className={styles.fitTitle}>{r.name[locale]}</span>
        <span className={styles.fitMeta}>{productDetail(r, locale, dict)}</span>
      </span>
    </IntentLink>
  );

  return (
    <div className={`container ${styles.page}`}>
      <nav aria-label={d.breadcrumb} className={styles.crumbs}>
        <ol role="list">
          <li>
            <Link href={localePath(locale, "/products")}>{dict.products.title}</Link>
          </li>
          <li>
            <IntentLink href={categoryHref(locale, p.category)}>{cat.name[locale]}</IntentLink>
          </li>
        </ol>
      </nav>

      <div className={styles.layout}>
        <div className={styles.media}>
          <ProductVisual
            image={p.image}
            icon={p.icon}
            alt={p.name[locale]}
            className={styles.tile}
            priority
            sizes="(max-width: 959px) 78vw, 440px"
          />
        </div>

        <div className={styles.info}>
          <div className={styles.intro}>
            <h1 className={`h2 ${styles.title}`}>{p.name[locale]}</h1>
            {summary ? (
              <p className={styles.summary}>
                {p.material ? <span className="visually-hidden">{d.material}: </span> : null}
                {summary}
              </p>
            ) : null}
            {pills ? (
              <ul role="list" className={styles.facts}>
                {sharedFacts.map((c) => (
                  <li key={c}>
                    {c === "fits" ? `${d.fits}: ` : <span className="visually-hidden">{d[c]}: </span>}
                    <bdi>{txt(first[c], locale)}</bdi>
                  </li>
                ))}
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
            ) : null}
          </div>

          <section className={styles.sizes} aria-labelledby="sizes-title">
            <div className={styles.sizesHead}>
              <h2 id="sizes-title" className="h3">
                {optionsLabel(p, locale, dict)}
              </h2>
              <p className={styles.byCase}>{d.soldByCase}</p>
            </div>
            {filter.length ? (
              <fieldset className={styles.filter}>
                <legend className="visually-hidden">{d.color}</legend>
                <label className={styles.pick}>
                  <input type="radio" name="color" value="0" defaultChecked />
                  <span>{d.allColors}</span>
                </label>
                {filter.map((color, i) => (
                  <label key={color} className={styles.pick}>
                    <input type="radio" name="color" value={i + 1} />
                    <span>{color}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <SizeTable {...table} product={p} variants={p.variants} columns={columns} caption={p.name[locale]} colors={filter} />
            <PricingNote enabled={prices} soon={dict.list.pricesSoon}>
              {d.pricing}{" "}
              <Link className="link" href={localePath(locale, "/request-account")}>
                {d.pricingCta}
              </Link>
            </PricingNote>
          </section>
        </div>
      </div>

      {fits.length || others.length ? (
        <section className={styles.related} aria-labelledby="goes-with">
          <h2 id="goes-with" className="h3">
            {d.goesWith}
          </h2>
          {fits.map(({ product: r, variants }) => {
            const shown = variants.slice(0, FIT_ROWS);
            return (
              <div key={r.slug} className={styles.fit}>
                {relatedHead(r, true)}
                <SizeTable
                  {...table}
                  product={r}
                  variants={shown}
                  columns={COLUMNS.filter((c) => shown.some((v) => v[c]))}
                  caption={r.name[locale]}
                />
              </div>
            );
          })}
          {others.length ? (
            <ul role="list" className={styles.others}>
              {others.map((r) => (
                <li key={r.slug}>{relatedHead(r, false)}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <ListBar
        locale={locale}
        href={listHref}
        labels={{ title: dict.list.title, view: dict.list.view, items: dict.list.items, cases: dict.list.cases }}
      />
    </div>
  );
}

/**
 * The sizes of one product, each with its Add button. A table on wide screens; on phones each row
 * stacks: its first value as the title, the rest on one line, then what a case holds.
 */
function SizeTable({
  product: p,
  variants,
  columns,
  caption,
  colors = [],
  locale,
  dict,
  labels,
  listHref,
  prices,
}: {
  product: Product;
  variants: Variant[];
  columns: Column[];
  caption: string;
  /** The colors of the filter above the table, in its order. Empty: no filter. */
  colors?: string[];
  locale: Locale;
  dict: Dict;
  labels: StepperLabels;
  listHref: string;
  prices: boolean;
}) {
  const d = dict.product;
  const comma = locale === "ar" ? "، " : ", ";
  const priceLabels = { locale, label: dict.portal.price, noPrice: dict.portal.noPrice };
  // On a cup, "fits 98 mm" is the lid it takes. Say so when every row that has one is such a cup.
  const fitted = variants.filter((v) => v.fits);
  const fitsLabel = fitted.length > 0 && fitted.every(namesItsLid) ? d.lidSize : d.fits;
  const heading = (c: Column) => (c === "fits" ? fitsLabel : d[c]);
  // "{n} per case" around the count, for phones. The count itself stays the cell's only text.
  const [before, after] = d.perCase.split("{n}");
  return (
    <table className={styles.table}>
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c} scope="col">
              {heading(c)}
            </th>
          ))}
          <th scope="col">{d.caseHead}</th>
          <PriceHead enabled={prices} label={dict.portal.price} />
          <th scope="col">
            <span className="visually-hidden">{d.order}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {variants.map((v) => {
          const name = `${p.name[locale]}, ${variantSummary(v, locale)}`.replace(/, $/, "");
          const said = (c: Column) => {
            const value = txt(v[c], locale);
            return value && c === "fits" ? `${fitsLabel}: ${isolate(value, locale)}` : isolate(value, locale);
          };
          // On phones a row's first value is its title and the rest collapse into one line under it. When the
          // first column is empty on this row (plain film beside meat film), the next value takes its place,
          // so the title never reads "–".
          const lead = Math.max(0, columns.findIndex((c) => txt(v[c], locale)));
          const compact = columns
            .filter((_, i) => i !== lead)
            .map(said)
            .filter(Boolean)
            .join(comma);
          const color = colors.indexOf(txt(v.color, locale)) + 1;
          const counted = v.packText != null || v.pack != null;
          return (
            <tr key={v.sku} data-c={color || undefined}>
              {columns.map((c, i) => (
                <td key={c} className={i === 0 ? styles.primary : styles.extra}>
                  {i === 0 && lead > 0 ? (
                    <>
                      <bdi className={styles.wideOnly}>–</bdi>
                      <bdi className={styles.narrowOnly}>{said(columns[lead])}</bdi>
                    </>
                  ) : (
                    <bdi>{txt(v[c], locale) || "–"}</bdi>
                  )}
                </td>
              ))}
              {compact ? <td className={styles.compact}>{compact}</td> : null}
              <td className={`num ${styles.caseCell}`}>
                <span className={styles.pack} data-before={counted ? before : undefined} data-after={counted ? after : undefined}>
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
  );
}
