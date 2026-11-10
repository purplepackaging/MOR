"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ClipboardList, Globe, Menu, X } from "lucide-react";
import {
  htmlLang,
  languageNames,
  locales,
  plural,
  switchPath,
  type Locale,
  type PluralForms,
} from "@/lib/i18n";
import { useList } from "@/lib/list-store";
import styles from "./Header.module.css";

/** Current path without the language prefix, e.g. "/products". */
function useBarePath(): string {
  const pathname = usePathname() || "/";
  const m = pathname.match(/^\/(es|tr|ar)(?=\/|$)/);
  return m ? pathname.slice(m[0].length) || "/" : pathname;
}

export function NavLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  const pathname = usePathname();
  const base = href.split("#")[0];
  const current = !href.includes("#") && (pathname === base || pathname.startsWith(`${base}/`));
  return (
    <Link href={href} className={className} aria-current={current ? "page" : undefined}>
      {children}
    </Link>
  );
}

let sessionCheck: { path: string; result: Promise<boolean> } | null = null;

/**
 * True once the visitor is known to be signed in. Only runs when the portal is on,
 * and checks again after each navigation so signing in or out shows right away.
 */
export function useSignedIn(enabled: boolean): boolean {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    if (sessionCheck?.path !== pathname) {
      sessionCheck = {
        path: pathname,
        result: fetch("/api/session", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : { signedIn: false }))
          .then((j: { signedIn?: boolean }) => Boolean(j.signedIn))
          .catch(() => false),
      };
    }
    let live = true;
    void sessionCheck.result.then((v) => live && setSignedIn(v));
    return () => {
      live = false;
    };
  }, [enabled, pathname]);
  return signedIn;
}

/** "Sign in", or "Your account" for signed-in customers. */
export function AccountLink({
  portal,
  signIn,
  account,
  className,
}: {
  portal: boolean;
  signIn: MenuLink;
  account: MenuLink;
  className?: string;
}) {
  const link = useSignedIn(portal) ? account : signIn;
  return (
    <NavLink href={link.href} className={className}>
      {link.label}
    </NavLink>
  );
}

/** "Create account", hidden once the visitor is signed in. */
export function CreateAccountLink({ portal, link, className }: { portal: boolean; link: MenuLink; className?: string }) {
  if (useSignedIn(portal)) return null;
  return (
    <Link href={link.href} className={className}>
      {link.label}
    </Link>
  );
}

function useDismiss(open: boolean, close: () => void, root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close, root]);
}

export function LanguageMenu({ locale, label }: { locale: Locale; label: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const path = useBarePath();
  useDismiss(open, () => setOpen(false), root);

  return (
    <div className={styles.lang} ref={root}>
      <button
        type="button"
        className={styles.langButton}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label}: ${languageNames[locale]}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Globe aria-hidden="true" />
        <span>{languageNames[locale]}</span>
      </button>
      <ul id={id} role="list" className={styles.langList} hidden={!open}>
        {locales.map((l) => (
          <li key={l}>
            <a
              href={switchPath(l, path)}
              hrefLang={htmlLang[l]}
              lang={htmlLang[l]}
              aria-current={l === locale ? "true" : undefined}
            >
              {languageNames[l]}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ListButton({
  href,
  label,
  countForms,
  locale,
}: {
  href: string;
  label: string;
  countForms: PluralForms;
  locale: Locale;
}) {
  const lines = useList();
  const count = lines.length;
  return (
    <Link href={href} className={styles.listButton} aria-label={count ? plural(locale, count, countForms) : label}>
      <ClipboardList aria-hidden="true" />
      <span className={styles.listLabel}>{label}</span>
      {count > 0 ? (
        <span className={styles.badge} aria-hidden="true">
          {count}
        </span>
      ) : null}
    </Link>
  );
}

interface MenuLink {
  href: string;
  label: string;
}

export function MobileMenu({
  locale,
  labels,
  links,
  signIn,
  account,
  portal,
  request,
}: {
  locale: Locale;
  labels: { menu: string; close: string; language: string };
  links: MenuLink[];
  signIn: MenuLink;
  account: MenuLink;
  portal: boolean;
  request: MenuLink;
}) {
  const [open, setOpen] = useState(false);
  const signedIn = useSignedIn(portal);
  const me = signedIn ? account : signIn;
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const path = useBarePath();
  const id = useId();

  useDismiss(
    open,
    () => {
      setOpen(false);
      button.current?.focus();
    },
    root,
  );

  // Close after navigating.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className={styles.mobile} ref={root}>
      <button
        ref={button}
        type="button"
        className={styles.menuButton}
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? labels.close : labels.menu}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </button>
      <div id={id} className={styles.sheet} hidden={!open}>
        <nav aria-label={labels.menu}>
          <ul role="list" className={styles.sheetLinks}>
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => setOpen(false)}>
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href={me.href} onClick={() => setOpen(false)}>
                {me.label}
              </Link>
            </li>
          </ul>
        </nav>
        {signedIn ? null : (
          <Link className={`btn ${styles.sheetCta}`} href={request.href} onClick={() => setOpen(false)}>
            {request.label}
          </Link>
        )}
        <div className={styles.sheetLangs}>
          <p className={styles.sheetLangLabel}>{labels.language}</p>
          <ul role="list">
            {locales.map((l) => (
              <li key={l}>
                <a
                  href={switchPath(l, path)}
                  hrefLang={htmlLang[l]}
                  lang={htmlLang[l]}
                  aria-current={l === locale ? "true" : undefined}
                >
                  {languageNames[l]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
