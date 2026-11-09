"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Leaf, Search, X } from "lucide-react";
import type { CategoryId } from "@/data/types";
import { fill, plural, type Locale, type PluralForms } from "@/lib/i18n";
import { matchesQuery } from "@/lib/text";
import { ProductCard, type CardData } from "./ProductCard";
import styles from "./ProductBrowser.module.css";

export interface BrowserItem extends CardData {
  category: CategoryId;
  search: string;
}

export interface BrowserCategory {
  id: CategoryId;
  name: string;
  href: string;
}

interface Labels {
  searchLabel: string;
  searchPlaceholder: string;
  clearSearch: string;
  all: string;
  categoriesLabel: string;
  plantBased: string;
  results: PluralForms;
  noResults: string;
  noResultsHint: string;
}

export function ProductBrowser({
  locale,
  items,
  categories,
  current,
  allHref,
  labels,
}: {
  locale: Locale;
  items: BrowserItem[];
  categories: BrowserCategory[];
  current?: CategoryId;
  allHref: string;
  labels: Labels;
}) {
  const [query, setQuery] = useState("");
  const [plantOnly, setPlantOnly] = useState(false);

  // Read ?q= and ?plant=1 after hydration so the static page stays cacheable.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q) setQuery(q.slice(0, 80));
    if (params.get("plant") === "1") setPlantOnly(true);
  }, []);

  // Keep the URL in step so a search can be shared or reloaded.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (query.trim()) url.searchParams.set("q", query.trim());
    else url.searchParams.delete("q");
    if (plantOnly) url.searchParams.set("plant", "1");
    else url.searchParams.delete("plant");
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [query, plantOnly]);

  const filtered = useMemo(
    () =>
      items.filter(
        (i) =>
          (!current || i.category === current) &&
          (!plantOnly || i.plantBased) &&
          (!query.trim() || matchesQuery(i.search, query)),
      ),
    [items, current, plantOnly, query],
  );

  const grouped = !current && !plantOnly && !query.trim();

  return (
    <div className={styles.browser}>
      <div className={styles.controls}>
        <div className={styles.search}>
          <label htmlFor="product-search" className="visually-hidden">
            {labels.searchLabel}
          </label>
          <Search className={styles.searchIcon} aria-hidden="true" />
          <input
            id="product-search"
            className={`input ${styles.searchInput}`}
            type="search"
            name="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={labels.searchPlaceholder}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
          />
          {query ? (
            <button type="button" className={styles.clear} onClick={() => setQuery("")} aria-label={labels.clearSearch}>
              <X aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <nav aria-label={labels.categoriesLabel} className={styles.chips}>
          <Link href={allHref} className={styles.chip} aria-current={!current ? "page" : undefined}>
            {labels.all}
          </Link>
          {categories.map((c) => (
            <Link key={c.id} href={c.href} className={styles.chip} aria-current={c.id === current ? "page" : undefined}>
              {c.name}
            </Link>
          ))}
        </nav>

        <button
          type="button"
          className={`${styles.chip} ${styles.toggle}`}
          aria-pressed={plantOnly}
          onClick={() => setPlantOnly((v) => !v)}
        >
          <Leaf aria-hidden="true" />
          {labels.plantBased}
        </button>
      </div>

      <p className={styles.count} aria-live="polite">
        {plural(locale, filtered.length, labels.results)}
      </p>

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          <p className="h3">{fill(labels.noResults, { q: query.trim() })}</p>
          <p className="muted">{labels.noResultsHint}</p>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setQuery(""); setPlantOnly(false); }}>
            {labels.clearSearch}
          </button>
        </div>
      ) : grouped ? (
        categories.map((c) => {
          const list = filtered.filter((i) => i.category === c.id);
          if (!list.length) return null;
          return (
            <section key={c.id} className={styles.group} aria-labelledby={`group-${c.id}`}>
              <div className={styles.groupHead}>
                <h2 id={`group-${c.id}`} className="h3">
                  {c.name}
                </h2>
                <Link href={c.href} className="link small">
                  {plural(locale, list.length, labels.results)}
                </Link>
              </div>
              <Grid items={list} headingLevel={3} />
            </section>
          );
        })
      ) : (
        <Grid items={filtered} headingLevel={2} />
      )}
    </div>
  );
}

/** Cards are h3 under a category h2, and h2 when the grid stands alone under the page h1. */
function Grid({ items, headingLevel }: { items: BrowserItem[]; headingLevel: 2 | 3 }) {
  return (
    <ul role="list" className={styles.grid}>
      {items.map((i) => (
        <li key={i.slug}>
          <ProductCard card={i} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}
