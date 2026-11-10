"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { checkSession, onSignedOut } from "./session-check";

/**
 * Prices on product pages. The pages are static, so a signed-in customer's prices
 * arrive after the page loads, from /api/prices. They are read from the database
 * there and only shown here.
 *
 *  out:    not signed in, or signed in without a business yet
 *  paused: every business they belong to is switched off
 *  soon:   an active customer, but no product has a cost yet
 *  ok:     price per case by SKU; a SKU without one is still to be confirmed
 */
export type PriceStatus = "out" | "paused" | "soon" | "ok";

export interface PriceState {
  status: PriceStatus;
  prices: Record<string, number> | null;
}

const OUT: PriceState = { status: "out", prices: null };

let state = OUT;
/** The sign-in check the current answer belongs to: one per page view. */
let loadedFor: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function set(next: PriceState) {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

// Signing out anywhere on the site drops the prices kept in memory.
onSignedOut(() => set(OUT));

function read(json: unknown): PriceState {
  const j = json as { status?: unknown; prices?: unknown } | null;
  if (j?.status === "ok" && j.prices && typeof j.prices === "object") {
    const prices: Record<string, number> = {};
    for (const [sku, value] of Object.entries(j.prices)) {
      if (typeof value === "number" && Number.isFinite(value)) prices[sku] = value;
    }
    return { status: "ok", prices };
  }
  if (j?.status === "soon" || j?.status === "paused") return { status: j.status, prices: null };
  return OUT;
}

async function load(path: string) {
  // The header runs a new check on every navigation, so coming back to a page
  // after signing in asks for prices again.
  const session = checkSession(path);
  if (loadedFor === session) return;
  loadedFor = session;
  let next = OUT;
  if (await session) {
    try {
      const r = await fetch("/api/prices", { cache: "no-store" });
      if (r.ok) next = read(await r.json());
    } catch {
      /* Offline or blocked: show no prices rather than old ones. */
    }
  }
  if (loadedFor === session) set(next);
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => OUT;

/**
 * This customer's prices on a static page. "out" until the first answer comes back;
 * after that the last answer stays up while each new page checks again.
 */
export function usePrices(enabled: boolean): PriceState {
  const pathname = usePathname();
  useEffect(() => {
    if (enabled) void load(pathname);
  }, [enabled, pathname]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
