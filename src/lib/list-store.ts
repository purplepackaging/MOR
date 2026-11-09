"use client";

import { useSyncExternalStore } from "react";

/** One line of the order list: a SKU and how many cases. */
export interface ListLine {
  sku: string;
  cases: number;
}

const KEY = "mor.list.v1";
const MAX_LINES = 150;
const EMPTY: ListLine[] = [];

let lines: ListLine[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function read(): ListLine[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed
      .filter(
        (l): l is ListLine =>
          !!l && typeof l.sku === "string" && Number.isInteger(l.cases) && l.cases > 0 && l.cases < 1000,
      )
      .slice(0, MAX_LINES);
  } catch {
    return EMPTY;
  }
}

function ensureLoaded() {
  if (!loaded && typeof window !== "undefined") {
    lines = read();
    loaded = true;
  }
}

function commit(next: ListLine[]) {
  lines = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* Private mode or storage full: the list still works for this visit. */
  }
  for (const l of listeners) l();
}

function onStorage(e: StorageEvent) {
  if (e.key !== KEY) return;
  lines = read();
  for (const l of listeners) l();
}

export const listStore = {
  subscribe(callback: () => void) {
    listeners.add(callback);
    if (listeners.size === 1) window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0) window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot(): ListLine[] {
    ensureLoaded();
    return lines;
  },
  getServerSnapshot(): ListLine[] {
    return EMPTY;
  },
  setCases(sku: string, cases: number) {
    ensureLoaded();
    const n = Math.max(0, Math.min(999, Math.round(cases)));
    const exists = lines.some((l) => l.sku === sku);
    if (n === 0) commit(lines.filter((l) => l.sku !== sku));
    else if (exists) commit(lines.map((l) => (l.sku === sku ? { sku, cases: n } : l)));
    else if (lines.length < MAX_LINES) commit([...lines, { sku, cases: n }]);
  },
  replace(next: ListLine[]) {
    commit(next);
  },
  clear() {
    commit(EMPTY);
  },
};

export function useList(): ListLine[] {
  return useSyncExternalStore(listStore.subscribe, listStore.getSnapshot, listStore.getServerSnapshot);
}

export function useCases(sku: string): number {
  return useList().find((l) => l.sku === sku)?.cases ?? 0;
}

const noopSubscribe = () => () => {};

/** False during server render and hydration, true after. Use it to avoid flashing an empty list. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
