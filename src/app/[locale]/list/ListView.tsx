"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { X } from "lucide-react";
import { AddToList, type StepperLabels } from "@/components/AddToList";
import { ProductVisual } from "@/components/ProductVisual";
import { showToast } from "@/components/Toaster";
import type { Dict } from "@/i18n";
import type { SkuInfo } from "@/lib/catalog";
import { fill, formatMoney, plural, type Locale } from "@/lib/i18n";
import { listStore, useHydrated, useList } from "@/lib/list-store";
import { placeOrder, saveUsualOrder } from "../account/actions";
import styles from "./list.module.css";

/** Present when a customer is signed in: the list becomes their order. */
export interface ListPortal {
  accountName: string;
  /** Price per case by SKU; null while the account has no price tier. */
  prices: Record<string, number> | null;
  ordersHref: string;
  signInHref: string;
  signInLabel: string;
  noPrice: string;
}

type Placed = { number: number; href: string };

export function ListView({
  locale,
  index,
  labels,
  caseLabel,
  stepper,
  browseHref,
  requestHref,
  portal,
}: {
  locale: Locale;
  index: Record<string, SkuInfo>;
  labels: Dict["list"];
  caseLabel: string;
  stepper: StepperLabels;
  browseHref: string;
  requestHref: string;
  portal?: ListPortal;
}) {
  const hydrated = useHydrated();
  const lines = useList();
  const known = lines.filter((l) => index[l.sku]);
  const emptyHeading = useRef<HTMLHeadingElement>(null);
  const focusEmpty = useRef(false);
  const placedHeading = useRef<HTMLHeadingElement>(null);
  const [note, setNote] = useState("");
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [placing, startPlacing] = useTransition();
  const [saving, startSaving] = useTransition();

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

  useEffect(() => {
    if (placed) placedHeading.current?.focus();
  }, [placed]);

  if (!hydrated) return <div className={styles.loading} aria-hidden="true" />;

  if (placed) {
    return (
      <div className={styles.empty}>
        <h2 className="h3" ref={placedHeading} tabIndex={-1}>
          {fill(labels.placedTitle, { n: placed.number })}
        </h2>
        <p className="muted">{labels.placedBody}</p>
        <div className={styles.placedActions}>
          <Link className="btn" href={placed.href}>
            {labels.viewOrder}
          </Link>
          <Link className="btn btn-quiet" href={browseHref}>
            {labels.keepShopping}
          </Link>
        </div>
      </div>
    );
  }

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
  const prices = portal?.prices ?? null;
  const unpriced = prices ? known.filter((l) => prices[l.sku] == null).length : 0;
  const subtotal = prices ? known.reduce((sum, l) => sum + (prices[l.sku] ?? 0) * l.cases, 0) : 0;
  const orderLines = known.map(({ sku, cases }) => ({ sku, cases }));

  const failure = (reason: string) =>
    reason === "signin" ? labels.signedOut : reason === "empty" ? labels.emptyTitle : labels.orderError;

  const place = () => {
    setProblem(null);
    startPlacing(async () => {
      const result = await placeOrder({ locale, lines: orderLines, note });
      if (!result.ok) {
        setProblem(failure(result.reason));
        return;
      }
      listStore.clear();
      setNote("");
      setPlaced({ number: result.number, href: `${portal?.ordersHref ?? ""}/${result.number}` });
    });
  };

  const saveUsual = () => {
    setProblem(null);
    startSaving(async () => {
      const result = await saveUsualOrder({ lines: orderLines });
      if (result.ok) showToast({ message: labels.savedUsual });
      else setProblem(result.reason === "signin" ? labels.signedOut : labels.usualError);
    });
  };

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
                  {prices ? (
                    <p className={styles.price}>
                      {prices[line.sku] != null ? (
                        <bdi>{fill(labels.perCase, { price: formatMoney(locale, prices[line.sku]) })}</bdi>
                      ) : (
                        portal?.noPrice
                      )}
                    </p>
                  ) : null}
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
        {portal ? <p className="small muted">{fill(labels.orderingFor, { name: portal.accountName })}</p> : null}
        <p className={styles.totals}>
          <span>{plural(locale, known.length, labels.items)}</span>
          <span>{plural(locale, totalCases, labels.cases)}</span>
        </p>
        {portal ? (
          <>
            {prices ? (
              <p className={styles.subtotal}>
                <span>{labels.subtotal}</span>
                <bdi>{formatMoney(locale, subtotal)}</bdi>
              </p>
            ) : null}
            {!prices || unpriced ? <p className="small muted">{prices ? labels.needsPrice : labels.pricesSoon}</p> : null}
            <div className="field">
              <label className="label" htmlFor="order-note">
                {labels.noteLabel}
              </label>
              <p className="hint" id="order-note-hint">
                {labels.noteHint}
              </p>
              <textarea
                id="order-note"
                className={`input ${styles.noteInput}`}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-describedby="order-note-hint"
              />
            </div>
            {problem ? (
              <p className="error-text" role="alert">
                {problem}{" "}
                {problem === labels.signedOut ? <Link href={portal.signInHref}>{portal.signInLabel}</Link> : null}
              </p>
            ) : null}
            <button type="button" className={`btn ${styles.send}`} onClick={place} disabled={placing || saving}>
              {placing ? labels.placing : labels.place}
            </button>
            <button type="button" className={`btn btn-quiet ${styles.send}`} onClick={saveUsual} disabled={placing || saving}>
              {saving ? labels.savingUsual : labels.saveUsual}
            </button>
          </>
        ) : (
          <>
            <Link className={`btn ${styles.send}`} href={requestHref}>
              {labels.send}
            </Link>
            <p className="small muted">{labels.note}</p>
          </>
        )}
        <button type="button" className={styles.clear} onClick={clear}>
          {labels.clear}
        </button>
      </aside>
    </div>
  );
}
