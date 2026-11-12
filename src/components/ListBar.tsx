"use client";

import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { plural, type Locale, type PluralForms } from "@/lib/i18n";
import { listStore } from "@/lib/list-store";
import styles from "./ListBar.module.css";

export interface ListBarLabels {
  /** "Your list" */
  title: string;
  /** "View list" */
  view: string;
  items: PluralForms;
  cases: PluralForms;
}

/**
 * The way back to the list from a product page, on phones: once something is on the list, a slip with the
 * ticket's torn edge sits at the foot of the screen with the count and "View list". Wide screens have
 * "Your list" in the header instead. It is fixed, so nothing on the page moves when it appears.
 */
export function ListBar({ locale, href, labels }: { locale: Locale; href: string; labels: ListBarLabels }) {
  const lines = useSyncExternalStore(listStore.subscribe, listStore.getSnapshot, listStore.getServerSnapshot);
  const bar = useRef<HTMLDivElement>(null);
  const loadedAt = useRef(0);
  const shown = lines.length > 0;

  useEffect(() => {
    loadedAt.current = Date.now();
  }, []);

  useEffect(() => {
    const el = bar.current;
    if (!shown || !el) return;
    // It rises when an Add puts the first item on the list. On a page that loads with a list, it is just there.
    if (loadedAt.current && Date.now() - loadedAt.current > 600) el.classList.add(styles.enter);
    // Toasts and focused controls stay clear of the bar: --bottom-bar is its height while it shows.
    const root = document.documentElement;
    const apply = () => {
      const h = el.offsetHeight;
      if (h) root.style.setProperty("--bottom-bar", `${h}px`);
      else root.style.removeProperty("--bottom-bar");
    };
    apply();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    resize?.observe(el);
    return () => {
      resize?.disconnect();
      root.style.removeProperty("--bottom-bar");
    };
  }, [shown]);

  if (!shown) return null;
  const cases = lines.reduce((sum, l) => sum + l.cases, 0);
  return (
    <div className={styles.bar} ref={bar} role="group" aria-label={labels.title} data-list-bar>
      <div className={styles.slip}>
        <p className={styles.text}>
          <span className={styles.label}>{labels.title}</span>
          <span className={styles.count}>
            {plural(locale, lines.length, labels.items)}
            {locale === "ar" ? "، " : ", "}
            {plural(locale, cases, labels.cases)}
          </span>
        </p>
        <Link className={`btn ${styles.view}`} href={href}>
          {labels.view}
        </Link>
      </div>
    </div>
  );
}
