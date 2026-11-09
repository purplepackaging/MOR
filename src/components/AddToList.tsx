"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { fill } from "@/lib/i18n";
import { listStore, useCases } from "@/lib/list-store";
import { showToast } from "./Toaster";
import styles from "./AddToList.module.css";

export interface StepperLabels {
  add: string;
  addTo: string;
  less: string;
  more: string;
  casesOf: string;
  added: string;
  view: string;
}

/**
 * "Add" button that turns into a case stepper once the item is in the list.
 * `min` is 0 on product pages (removes the line) and 1 on the list page.
 */
export function AddToList({
  sku,
  name,
  labels,
  listHref,
  min = 0,
  compact = false,
}: {
  sku: string;
  name: string;
  labels: StepperLabels;
  listHref?: string;
  min?: 0 | 1;
  compact?: boolean;
}) {
  const cases = useCases(sku);
  const [draft, setDraft] = useState<string | null>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const focusPlus = useRef(false);

  useEffect(() => {
    if (cases > 0 && focusPlus.current) {
      focusPlus.current = false;
      plusRef.current?.focus();
    }
  }, [cases]);

  if (cases === 0 && min === 0) {
    return (
      <button
        type="button"
        className={`${styles.add} ${compact ? styles.compact : ""}`}
        aria-label={fill(labels.addTo, { name })}
        onClick={() => {
          focusPlus.current = true;
          listStore.setCases(sku, 1);
          showToast({
            message: fill(labels.added, { name }),
            action: listHref ? { label: labels.view, href: listHref } : undefined,
          });
        }}
      >
        <Plus aria-hidden="true" />
        <span>{labels.add}</span>
      </button>
    );
  }

  const commit = (value: string) => {
    const n = Number.parseInt(value, 10);
    setDraft(null);
    if (Number.isFinite(n)) listStore.setCases(sku, Math.max(min, Math.min(999, n)));
  };

  return (
    <div role="group" aria-label={fill(labels.casesOf, { name })} className={`${styles.stepper} ${compact ? styles.compact : ""}`}>
      <button
        type="button"
        className={styles.step}
        aria-label={fill(labels.less, { name })}
        disabled={cases <= min}
        onClick={() => listStore.setCases(sku, Math.max(min, cases - 1))}
      >
        <Minus aria-hidden="true" />
      </button>
      <input
        className={styles.qty}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={fill(labels.casesOf, { name })}
        value={draft ?? String(cases)}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 3))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }}
        autoComplete="off"
      />
      <button
        ref={plusRef}
        type="button"
        className={styles.step}
        aria-label={fill(labels.more, { name })}
        disabled={cases >= 999}
        onClick={() => listStore.setCases(sku, cases + 1)}
      >
        <Plus aria-hidden="true" />
      </button>
    </div>
  );
}
