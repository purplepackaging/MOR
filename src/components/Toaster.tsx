"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import styles from "./Toaster.module.css";

interface Toast {
  id: number;
  message: string;
  action?: { label: string; href?: string; onClick?: () => void };
}

let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function showToast(toast: Omit<Toast, "id">, ms = 5000) {
  current = { ...toast, id: Date.now() };
  emit();
  clearTimeout(timer);
  timer = setTimeout(dismissToast, ms);
}

export function dismissToast() {
  current = null;
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** One polite live region for the whole site, mounted once in the layout. */
export function Toaster() {
  const toast = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );

  return (
    <div className={styles.region} role="status" aria-live="polite" aria-atomic="true">
      {toast ? (
        <div className={styles.toast} key={toast.id}>
          <Check className={styles.icon} aria-hidden="true" />
          <span className={styles.message}>{toast.message}</span>
          {toast.action?.href ? (
            <Link className={styles.action} href={toast.action.href} onClick={dismissToast}>
              {toast.action.label}
            </Link>
          ) : toast.action?.onClick ? (
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                toast.action?.onClick?.();
                dismissToast();
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
