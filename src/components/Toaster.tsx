"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { Check, Info } from "lucide-react";
import styles from "./Toaster.module.css";

interface Toast {
  id: number;
  message: string;
  /** "check" confirms something that was done (the default); "info" is a notice. */
  icon?: "check" | "info";
  action?: { label: string; href?: string; onClick?: () => void };
  /** Shown just before moving to another page, and meant to be read there. */
  travels?: boolean;
}

/** The toast on screen, and the page it belongs to (null until a travelling toast arrives). */
let current: (Toast & { path: string | null }) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function showToast(toast: Omit<Toast, "id">, ms = 5000) {
  current = { ...toast, id: Date.now(), path: toast.travels ? null : window.location.pathname };
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
  const pathname = usePathname();
  // A toast confirms something done on one page. It does not follow the visitor to the next.
  useEffect(() => {
    if (!current) return;
    const here = window.location.pathname;
    if (current.path === null) current.path = here;
    else if (current.path !== here) dismissToast();
  }, [pathname]);

  const toast = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );

  return (
    <div className={styles.region} role="status" aria-live="polite" aria-atomic="true">
      {toast ? (
        <div className={styles.toast} key={toast.id}>
          {toast.icon === "info" ? (
            <Info className={styles.icon} aria-hidden="true" />
          ) : (
            <Check className={styles.icon} aria-hidden="true" />
          )}
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
