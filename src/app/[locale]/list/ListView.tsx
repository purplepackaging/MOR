"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { AddToList, type StepperLabels } from "@/components/AddToList";
import { ProductVisual } from "@/components/ProductVisual";
import { showToast } from "@/components/Toaster";
import type { Dict } from "@/i18n";
import type { SkuInfo } from "@/lib/catalog";
import { fill, plural, type Locale } from "@/lib/i18n";
import { listStore, useHydrated, useList } from "@/lib/list-store";
import styles from "./list.module.css";

export function ListView({
  locale,
  index,
  labels,
  caseLabel,
  stepper,
  browseHref,
  requestHref,
}: {
  locale: Locale;
  index: Record<string, SkuInfo>;
  labels: Dict["list"];
  caseLabel: string;
  stepper: StepperLabels;
  browseHref: string;
  requestHref: string;
}) {
  const hydrated = useHydrated();
  const lines = useList();
  const known = lines.filter((l) => index[l.sku]);
  const emptyHeading = useRef<HTMLHeadingElement>(null);
  const focusEmpty = useRef(false);

  // Drop SKUs the catalog no longer has, so counts stay honest.
  useEffect(() => {
    if (hydrated && known.length !== lines.length) listStore.replace(known);
  }, [hydrated, known, lines.length]);

  useEffect(() => {
    if (known.length === 0 && focusEmpty.current) {
      focusEmpty.current = false;
      emptyHeading.current?.focus();
    }
  }, [known.length]);

  if (!hydrated) return <div className={styles.loading} aria-hidden="true" />;

  if (known.length === 0) {
    return (
      <div className={styles.empty}>
        <h2 className="h3" ref={emptyHeading} tabIndex={-1}>
          {labels.emptyTitle}
        </h2>
        <p className="muted">{labels.emptyBody}</p>
        <Link className="btn" href={browseHref}>
          {labels.browse}
        </Link>
      </div>
    );
  }

  const totalCases = known.reduce((sum, l) => sum + l.cases, 0);

  const remove = (sku: string, name: string) => {
    const before = listStore.getSnapshot();
    const at = known.findIndex((l) => l.sku === sku);
    const next = known[at + 1] ?? known[at - 1];
    if (!next) focusEmpty.current = true;
    listStore.setCases(sku, 0);
    showToast({ message: fill(labels.removed, { name }), action: { label: labels.undo, onClick: () => listStore.replace(before) } });
    if (next) requestAnimationFrame(() => document.getElementById(`remove-${next.sku}`)?.focus());
  };

  const clear = () => {
    const before = listStore.getSnapshot();
    focusEmpty.current = true;
    listStore.clear();
    showToast({ message: labels.cleared, action: { label: labels.undo, onClick: () => listStore.replace(before) } });
  };

  return (
    <div className={styles.layout}>
      <div className={styles.ticket}>
        <ul role="list" className={styles.lines}>
          {known.map((line) => {
            const info = index[line.sku];
            const full = info.summary ? `${info.name}, ${info.summary}` : info.name;
            return (
              <li key={line.sku} className={styles.line}>
                <Link href={info.href} className={styles.thumb} tabIndex={-1} aria-hidden="true">
                  <ProductVisual image={info.image} icon={info.icon} sizes={128} />
                </Link>
                <div className={styles.text}>
                  <Link href={info.href} className={styles.name}>
                    {info.name}
                  </Link>
                  {info.summary ? <p className={styles.summary}>{info.summary}</p> : null}
                  <p className={styles.pack}>
                    {caseLabel}: <span className="num">{info.pack}</span>
                  </p>
                </div>
                <div className={styles.controls}>
                  <AddToList sku={line.sku} name={full} labels={stepper} min={1} compact />
                  <button
                    type="button"
                    id={`remove-${line.sku}`}
                    className={styles.remove}
                    aria-label={fill(labels.remove, { name: full })}
                    onClick={() => remove(line.sku, full)}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <aside className={styles.summaryPanel} aria-labelledby="list-summary">
        <h2 id="list-summary" className="visually-hidden">
          {labels.summary}
        </h2>
        <p className={styles.totals}>
          <span>{plural(locale, known.length, labels.items)}</span>
          <span>{plural(locale, totalCases, labels.cases)}</span>
        </p>
        <Link className={`btn ${styles.send}`} href={requestHref}>
          {labels.send}
        </Link>
        <p className="small muted">{labels.note}</p>
        <button type="button" className={styles.clear} onClick={clear}>
          {labels.clear}
        </button>
      </aside>
    </div>
  );
}
