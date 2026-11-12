"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Leaf, Search, X } from "lucide-react";
import type { CategoryId } from "@/data/types";
import { fill, plural, type Locale, type PluralForms } from "@/lib/i18n";
import { matchesQuery, nameRank } from "@/lib/text";
import type { CardPriceLabels } from "./CardPrice";
import { IntentLink } from "./IntentLink";
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
  prices,
}: {
  locale: Locale;
  items: BrowserItem[];
  categories: BrowserCategory[];
  current?: CategoryId;
  allHref: string;
  labels: Labels;
  /** Words for a signed-in customer's price on each card. Left out while the portal is off. */
  prices?: CardPriceLabels;
}) {
  const [query, setQuery] = useState("");
  const [plantOnly, setPlantOnly] = useState(false);
  /** True once the search field has scrolled out of sight. The category row then offers a way back to it. */
  const [searchAway, setSearchAway] = useState(false);
  /** Phones only: whether the list of categories is open under the bar. */
  const [open, setOpen] = useState(false);
  const searchBox = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const catsButton = useRef<HTMLButtonElement>(null);

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

  // The search field scrolls away with the page and the category row stays under the header.
  useEffect(() => {
    const el = searchBox.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 64;
    const observer = new IntersectionObserver(([entry]) => setSearchAway(!entry.isIntersecting), {
      rootMargin: `-${header}px 0px 0px 0px`,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The open list closes on a tap anywhere else and on Escape.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      catsButton.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const toSearch = () => {
    input.current?.focus({ preventScroll: true });
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: calm ? "auto" : "smooth" });
  };

  const filtered = useMemo(() => {
    const q = query.trim();
    const found = items.filter(
      (i) => (!current || i.category === current) && (!plantOnly || i.plantBased) && (!q || matchesQuery(i.search, q)),
    );
    // A product whose own name answers the search comes before one found by a size, a material or another word.
    return q ? [...found].sort((a, b) => nameRank(a.name, q) - nameRank(b.name, q)) : found;
  }, [items, current, plantOnly, query]);

  const grouped = !current && !plantOnly && !query.trim();
  const currentName = categories.find((c) => c.id === current)?.name ?? labels.all;
  // The filter has two homes and shows in one: beside the search field on wide screens, in the list of categories on phones.
  const plantToggle = (place: string) => (
    <button type="button" className={`${styles.chip} ${styles.toggle} ${place}`} aria-pressed={plantOnly} onClick={() => setPlantOnly((v) => !v)}>
      <Leaf aria-hidden="true" />
      {labels.plantBased}
    </button>
  );

  return (
    <div className={styles.browser}>
      <div className={styles.top}>
        <div className={styles.search} ref={searchBox}>
          <label htmlFor="product-search" className="visually-hidden">
            {labels.searchLabel}
          </label>
          <Search className={styles.searchIcon} aria-hidden="true" />
          <input
            ref={input}
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
        {plantToggle(styles.wide)}
      </div>

      {/*
        The bar stays under the header while the page scrolls. Wide screens: every category in it, wrapped.
        Phones: one button that names the category on show and opens the whole list, and the plant-based
        filter, under the bar.
      */}
      <div className={styles.bar} ref={bar} data-open={open || undefined}>
        <button
          type="button"
          ref={catsButton}
          className={`${styles.chip} ${styles.cats}`}
          aria-expanded={open}
          aria-controls="product-categories"
          aria-label={`${labels.categoriesLabel}: ${currentName}${plantOnly ? `, ${labels.plantBased}` : ""}`}
          onClick={() => setOpen((v) => !v)}
        >
          {plantOnly ? <Leaf className={styles.leaf} aria-hidden="true" /> : null}
          <span className={styles.catsName}>{currentName}</span>
          <ChevronDown className={styles.chevron} aria-hidden="true" />
        </button>
        <div id="product-categories" className={styles.panel}>
          <nav aria-label={labels.categoriesLabel} className={styles.row}>
            <Link href={allHref} className={styles.chip} aria-current={!current ? "page" : undefined} onClick={() => setOpen(false)}>
              {labels.all}
            </Link>
            {categories.map((c) => (
              <IntentLink
                key={c.id}
                href={c.href}
                className={styles.chip}
                aria-current={c.id === current ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {c.name}
              </IntentLink>
            ))}
          </nav>
          {plantToggle(styles.narrow)}
        </div>
        {/* Always in the bar, so nothing in it moves when the search field scrolls out of sight and this shows. */}
        <button type="button" className={styles.find} data-away={searchAway || undefined} onClick={toSearch} aria-label={labels.searchLabel}>
          <Search aria-hidden="true" />
        </button>
      </div>

      <p className={styles.count} aria-live="polite">
        {plural(locale, filtered.length, labels.results)}
      </p>

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          <p className="h3">{fill(labels.noResults, { q: query.trim() })}</p>
          <p className="muted">{labels.noResultsHint}</p>
          <button type="button" className="btn btn-quiet" onClick={() => { setQuery(""); setPlantOnly(false); }}>
            {labels.clearSearch}
          </button>
          {/* A search that finds nothing still leaves somewhere to go. */}
          <ul role="list" className={styles.suggest} aria-label={labels.categoriesLabel}>
            {categories.map((c) => (
              <li key={c.id}>
                <IntentLink href={c.href} className={styles.chip}>
                  {c.name}
                </IntentLink>
              </li>
            ))}
          </ul>
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
                <IntentLink href={c.href} className="link small">
                  {plural(locale, list.length, labels.results)}
                </IntentLink>
              </div>
              <Grid items={list} headingLevel={3} prices={prices} />
            </section>
          );
        })
      ) : (
        <Grid items={filtered} headingLevel={2} prices={prices} />
      )}
    </div>
  );
}

/** Cards are h3 under a category h2, and h2 when the grid stands alone under the page h1. */
function Grid({ items, headingLevel, prices }: { items: BrowserItem[]; headingLevel: 2 | 3; prices?: CardPriceLabels }) {
  return (
    <ul role="list" className={styles.grid}>
      {items.map((i) => (
        <li key={i.slug}>
          <ProductCard card={i} headingLevel={headingLevel} prices={prices} />
        </li>
      ))}
    </ul>
  );
}
