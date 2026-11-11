"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
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
  /** Price per case by SKU; null while no product has a cost yet. */
  prices: Record<string, number> | null;
  /** Delivery fees from Supabase; null if they could not be loaded. */
  fees: { delivery: number; nextDay: number } | null;
  cardFeePercent: string;
  ordersHref: string;
  signInHref: string;
  signInLabel: string;
  noPrice: string;
  /** Screen-reader label for what a line comes to. */
  lineTotal: string;
}

/** With the portal on and nobody signed in: the list asks them to sign in to order. */
export interface ListSignIn {
  href: string;
}

type Placed = { number: number; href: string };

/** Below this width the summary sits under the lines instead of beside them. */
const STACKED = "(max-width: 959px)";
/** Space kept clear at the bottom of the screen for the order bar, in px. */
const BAR_ROOM = 88;

function subscribeStacked(callback: () => void) {
  const query = window.matchMedia(STACKED);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

export function ListView({
  locale,
  index,
  labels,
  caseLabel,
  stepper,
  browseHref,
  requestHref,
  portal,
  signIn,
}: {
  locale: Locale;
  index: Record<string, SkuInfo>;
  labels: Dict["list"];
  caseLabel: string;
  stepper: StepperLabels;
  browseHref: string;
  requestHref: string;
  portal?: ListPortal;
  signIn?: ListSignIn;
}) {
  const hydrated = useHydrated();
  const lines = useList();
  const known = lines.filter((l) => index[l.sku]);
  const emptyHeading = useRef<HTMLHeadingElement>(null);
  const focusEmpty = useRef(false);
  const placedHeading = useRef<HTMLHeadingElement>(null);
  const [note, setNote] = useState("");
  const [nextDay, setNextDay] = useState(false);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [placing, startPlacing] = useTransition();
  const [saving, startSaving] = useTransition();
  const problemText = useRef<HTMLParagraphElement>(null);
  /** The order button in the summary, and whether it is still below the screen. */
  const [action, setAction] = useState<HTMLElement | null>(null);
  const [actionBelow, setActionBelow] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const stacked = useSyncExternalStore(
    subscribeStacked,
    () => window.matchMedia(STACKED).matches,
    () => false,
  );
  const [announced, setAnnounced] = useState("");
  const firstSummary = useRef(true);
  /** Above zero once lines for items that are not for sale came off the list, so we can say so. */
  const [dropped, setDropped] = useState(0);
  const droppedNote = useRef<HTMLParagraphElement>(null);
  const focusDropped = useRef(false);

  const totalCases = known.reduce((sum, l) => sum + l.cases, 0);
  const prices = portal?.prices ?? null;
  const fees = portal?.fees ?? null;
  const unpriced = prices ? known.filter((l) => prices[l.sku] == null).length : 0;
  // Shown for reading only. The order is priced again in the database when it is placed.
  const cents = (n: number) => Math.round(n * 100);
  const subtotal = prices ? known.reduce((sum, l) => sum + cents(prices[l.sku] ?? 0) * l.cases, 0) / 100 : 0;
  const total =
    prices && fees && unpriced === 0 ? (cents(subtotal) + cents(fees.delivery) + (nextDay ? cents(fees.nextDay) : 0)) / 100 : null;
  const orderLines = known.map(({ sku, cases }) => ({ sku, cases }));
  const itemCount = plural(locale, known.length, labels.items);
  const caseCount = plural(locale, totalCases, labels.cases);
  const totalLabel = total == null ? labels.total : labels.totalWithDelivery;
  const totalText = total == null ? (portal?.noPrice ?? "") : formatMoney(locale, total);
  const summaryText = `${[itemCount, caseCount, ...(portal && fees ? [`${totalLabel}: ${totalText}`] : [])].join(". ")}.`;
  const barShown = hydrated && stacked && !placed && known.length > 0 && Boolean(portal || signIn) && actionBelow;

  // Take lines for items that are not for sale off the list, so counts stay honest, and say so.
  useEffect(() => {
    if (hydrated && known.length !== lines.length) {
      listStore.replace(known);
      setDropped((n) => n || 1);
    }
  }, [hydrated, known, lines.length]);

  // When an order was held back for it, the note is what the customer needs to read next.
  useEffect(() => {
    if (dropped && focusDropped.current) {
      focusDropped.current = false;
      droppedNote.current?.focus();
      droppedNote.current?.scrollIntoView({ block: "center" });
    }
  }, [dropped]);

  useEffect(() => {
    if (known.length === 0 && focusEmpty.current) {
      focusEmpty.current = false;
      emptyHeading.current?.focus();
    }
  }, [known.length]);

  useEffect(() => {
    if (placed) placedHeading.current?.focus();
  }, [placed]);

  // On a phone the order button sits below every line. While it is still below the
  // screen, a bar at the bottom keeps the total and the button in reach.
  useEffect(() => {
    if (!action || typeof IntersectionObserver === "undefined") return;
    // Leave room for the bar, so the button is in full view before the bar goes.
    const check = () => setActionBelow(action.getBoundingClientRect().bottom > window.innerHeight - BAR_ROOM + 1);
    // The observer catches the button moving as the list changes; the scroll listener
    // catches jumps that take it from above the screen to below it in one step.
    const observer = new IntersectionObserver(check, { rootMargin: `0px 0px -${BAR_ROOM}px 0px`, threshold: [0, 1] });
    observer.observe(action);
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        check();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [action]);

  // Toasts and keyboard focus stay clear of the bar while it shows.
  useEffect(() => {
    const el = bar.current;
    if (!barShown || !el) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty("--bottom-bar", `${el.offsetHeight}px`);
    apply();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    resize?.observe(el);
    return () => {
      resize?.disconnect();
      root.style.removeProperty("--bottom-bar");
    };
  }, [barShown]);

  // Screen readers hear the new count and total a moment after a change, not on every tap.
  useEffect(() => {
    if (!hydrated) return;
    if (firstSummary.current) {
      firstSummary.current = false;
      return;
    }
    const timer = setTimeout(() => setAnnounced(summaryText), 700);
    return () => clearTimeout(timer);
  }, [hydrated, summaryText]);

  // A problem shows beside the order button in the summary, so bring it into view.
  useEffect(() => {
    if (problem) problemText.current?.scrollIntoView({ block: "center" });
  }, [problem]);

  if (!hydrated) return <div className={styles.loading} aria-hidden="true" />;

  // Shown in the same paint as the list, before the lines come off, so nothing jumps.
  const droppedNotice =
    dropped || known.length !== lines.length ? (
      <p className={styles.notice} role="status" ref={droppedNote} tabIndex={-1}>
        {labels.unavailable}
      </p>
    ) : null;

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
        {droppedNotice}
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

  const failure = (reason: string) =>
    reason === "signin" ? labels.signedOut : reason === "empty" ? labels.emptyTitle : labels.orderError;

  // The server found items that went off sale after this page loaded. Nothing was
  // ordered or saved: take them off the list and say so, so the customer can check it.
  const takeOff = (skus: string[]) => {
    focusDropped.current = true;
    listStore.replace(listStore.getSnapshot().filter((l) => !skus.includes(l.sku)));
    setDropped((n) => n + 1);
  };

  const place = () => {
    setProblem(null);
    startPlacing(async () => {
      const result = await placeOrder({ locale, lines: orderLines, note, nextDay });
      if (!result.ok) {
        if (result.reason === "unavailable") takeOff(result.skus);
        else setProblem(failure(result.reason));
        return;
      }
      listStore.clear();
      setNote("");
      setNextDay(false);
      setPlaced({ number: result.number, href: `${portal?.ordersHref ?? ""}/${result.number}` });
    });
  };

  const saveUsual = () => {
    setProblem(null);
    startSaving(async () => {
      const result = await saveUsualOrder({ lines: orderLines });
      if (result.ok) showToast({ message: labels.savedUsual });
      else if (result.reason === "unavailable") takeOff(result.skus);
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
      {barShown ? (
        <div className={styles.bar} ref={bar} role="group" aria-label={labels.summary} data-order-bar>
          {portal && fees ? (
            <p className={styles.barText}>
              <span className={styles.barLabel}>{totalLabel}</span>
              <span className={styles.barAmount}>{total == null ? totalText : <bdi>{totalText}</bdi>}</span>
            </p>
          ) : (
            <p className={styles.barText}>
              <span className={styles.barAmount}>{itemCount}</span>
              <span className={styles.barLabel}>{caseCount}</span>
            </p>
          )}
          {portal ? (
            <button type="button" className={`btn ${styles.barButton}`} onClick={place} disabled={placing || saving}>
              {placing ? labels.placing : labels.place}
            </button>
          ) : signIn ? (
            <Link className={`btn ${styles.barButton}`} href={signIn.href}>
              {labels.signInToOrder}
            </Link>
          ) : null}
        </div>
      ) : null}
      <div className={styles.ticket}>
        {droppedNotice}
        <ul role="list" className={styles.lines}>
          {known.map((line) => {
            const info = index[line.sku];
            const full = info.summary ? `${info.name}, ${info.summary}` : info.name;
            const price = prices?.[line.sku];
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
                {prices ? (
                  <p className={styles.price}>
                    {price != null ? <bdi>{fill(labels.perCase, { price: formatMoney(locale, price) })}</bdi> : portal?.noPrice}
                  </p>
                ) : null}
                <div className={styles.controls}>
                  <div className={styles.qty}>
                    <AddToList sku={line.sku} name={full} labels={stepper} min={1} />
                  </div>
                  {prices && price != null ? (
                    <p className={styles.lineTotal}>
                      <span className="visually-hidden">{portal?.lineTotal}: </span>
                      <bdi>{formatMoney(locale, (cents(price) * line.cases) / 100)}</bdi>
                    </p>
                  ) : prices ? (
                    <span className={styles.lineTotal} aria-hidden="true" />
                  ) : null}
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
          <span>{itemCount}</span>
          <span>{caseCount}</span>
        </p>
        <p className="visually-hidden" role="status">
          {announced}
        </p>
        {portal ? (
          <>
            {prices || fees ? (
              <dl className={styles.costs}>
                {prices ? (
                  <div>
                    <dt>{labels.subtotal}</dt>
                    <dd>
                      <bdi>{formatMoney(locale, subtotal)}</bdi>
                    </dd>
                  </div>
                ) : null}
                {fees ? (
                  <div>
                    <dt>{labels.delivery}</dt>
                    <dd>
                      <bdi>{formatMoney(locale, fees.delivery)}</bdi>
                    </dd>
                  </div>
                ) : null}
                {fees && nextDay ? (
                  <div>
                    <dt>{labels.nextDay}</dt>
                    <dd>
                      <bdi>{formatMoney(locale, fees.nextDay)}</bdi>
                    </dd>
                  </div>
                ) : null}
                {fees ? (
                  <div className={styles.costsTotal}>
                    <dt>{labels.total}</dt>
                    <dd>{total == null ? portal.noPrice : <bdi>{formatMoney(locale, total)}</bdi>}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            {fees ? (
              <label className={styles.nextDayOption}>
                <input type="checkbox" checked={nextDay} onChange={(e) => setNextDay(e.target.checked)} />
                <span>{fill(labels.nextDayOption, { price: formatMoney(locale, fees.nextDay) })}</span>
              </label>
            ) : null}
            {!prices || unpriced ? <p className="small muted">{prices ? labels.needsPrice : labels.pricesSoon}</p> : null}
            <p className="small muted">{fill(labels.cardFee, { pct: portal.cardFeePercent })}</p>
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
              <p className="error-text" role="alert" ref={problemText}>
                {problem}{" "}
                {problem === labels.signedOut ? <Link href={portal.signInHref}>{portal.signInLabel}</Link> : null}
              </p>
            ) : null}
            <button type="button" className={`btn ${styles.send}`} onClick={place} disabled={placing || saving} ref={setAction}>
              {placing ? labels.placing : labels.place}
            </button>
            <button type="button" className={`btn btn-quiet ${styles.send}`} onClick={saveUsual} disabled={placing || saving}>
              {saving ? labels.savingUsual : labels.saveUsual}
            </button>
          </>
        ) : signIn ? (
          <>
            <Link className={`btn ${styles.send}`} href={signIn.href} ref={setAction}>
              {labels.signInToOrder}
            </Link>
            <p className="small muted">{labels.signInToOrderNote}</p>
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
