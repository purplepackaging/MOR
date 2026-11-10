"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";
import { LoopMark } from "@/components/Wordmark";
import type { Dict } from "@/i18n";
import { fill, languageNames, locales, type Locale } from "@/lib/i18n";
import { BUSINESS_TYPES, type SetupKey } from "@/lib/request-validation";
import { createAccount, type SetupState } from "../actions";
import styles from "../../request-account/request.module.css";

/** Order used to move focus to the first problem. Matches the order on screen. */
const FIELD_ORDER: SetupKey[] = ["businessName", "street", "city", "zip", "contactName", "phone"];

interface Props {
  locale: Locale;
  next: string | null;
  email: string;
  rep: { code: string; name: string } | null;
  t: Dict["setup"];
  r: Dict["request"];
  hrefs: { sms: string; privacy: string };
}

export function SetupForm({ locale, next, email, rep, t, r, hrefs }: Props) {
  const [state, action, pending] = useActionState<SetupState, FormData>(createAccount, {});
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state.errors ?? {};

  useEffect(() => {
    const first = FIELD_ORDER.find((k) => state.errors?.[k]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  }, [state]);

  const errorText = (key: SetupKey): string | undefined => {
    const code = errors[key];
    if (!code) return undefined;
    if (code === "required") return fill(r.errors.required, { field: r.fieldNames[key] });
    return r.errors[code];
  };
  const field = (name: SetupKey) => ({ name, label: r[name], error: errorText(name) });
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <div className={styles.formWrap}>
      <header className={styles.head}>
        <h1 className="h2">{t.title}</h1>
        <p className="lede">{t.lede}</p>
        <p className="small muted">
          <bdi>{fill(t.signedInAs, { email })}</bdi>
        </p>
        {rep ? (
          <p className={styles.rep}>
            <LoopMark className={styles.repMark} />
            {fill(r.repBanner, { rep: rep.name })}
          </p>
        ) : null}
      </header>

      <form ref={formRef} action={action} className={styles.form} noValidate>
        <input type="hidden" name="locale" value={locale} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {rep ? <input type="hidden" name="repCode" value={rep.code} /> : null}
        <div className={styles.trap} aria-hidden="true">
          <label htmlFor="su-website">Website</label>
          <input id="su-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>{r.business}</legend>
          <TextField {...field("businessName")} autoComplete="organization" maxLength={120} required />
          <div className="field">
            <label className="label" htmlFor="su-businessType">
              {r.businessType} <span className="optional">({r.optional})</span>
            </label>
            <select id="su-businessType" name="businessType" className="input" defaultValue="">
              <option value="">{r.choose}</option>
              {BUSINESS_TYPES.map((type) => (
                <option key={type} value={type}>
                  {r.types[type]}
                </option>
              ))}
            </select>
          </div>
          <TextField {...field("street")} autoComplete="address-line1" maxLength={160} required />
          <div className={styles.pair}>
            <TextField {...field("city")} autoComplete="address-level2" maxLength={80} required />
            <TextField
              {...field("zip")}
              autoComplete="postal-code"
              inputMode="numeric"
              maxLength={10}
              spellCheck={false}
              className={styles.zip}
              required
            />
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>{r.contact}</legend>
          <TextField {...field("contactName")} autoComplete="name" maxLength={80} required />
          <TextField
            {...field("phone")}
            hint={t.phoneHint}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            required
          />
          <div className="field">
            <label className="label" htmlFor="su-language">
              {r.language}
            </label>
            <select id="su-language" name="language" className="input" defaultValue={locale}>
              {locales.map((l) => (
                <option key={l} value={l}>
                  {languageNames[l]}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.consent}>
            <input id="su-sms" name="smsConsent" type="checkbox" className={styles.check} />
            <div>
              <label htmlFor="su-sms" className={styles.consentText}>
                {r.sms}
              </label>
              <p className={styles.consentLinks}>
                <Link className="link" href={hrefs.sms}>
                  {r.smsTerms}
                </Link>
                <Link className="link" href={hrefs.privacy}>
                  {r.privacy}
                </Link>
              </p>
            </div>
          </div>
          {rep ? null : (
            <div className={`field ${styles.short}`}>
              <label className="label" htmlFor="su-repCode">
                {r.repCode} <span className="optional">({r.optional})</span>
              </label>
              <p className="hint" id="su-repCode-hint">
                {r.repCodeHint}
              </p>
              <input
                id="su-repCode"
                name="repCode"
                className="input"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={12}
                aria-describedby="su-repCode-hint"
              />
            </div>
          )}
        </fieldset>

        <div className={styles.submitRow}>
          {state.failed ? (
            <p className={styles.failure} role="alert">
              {t.failed}
            </p>
          ) : hasErrors ? (
            <p className={styles.failure} role="alert">
              {r.errors.summary}
            </p>
          ) : null}
          <button type="submit" className={`btn ${styles.submit}`} disabled={pending}>
            {pending ? (
              <>
                <LoaderCircle className={styles.spin} aria-hidden="true" />
                {t.saving}
              </>
            ) : (
              t.submit
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function TextField({
  name,
  label,
  hint,
  error,
  className,
  ...input
}: {
  name: SetupKey;
  label: string;
  hint?: string;
  error?: string;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "id" | "className">) {
  const id = `su-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${className ?? ""}`}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {hint ? (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="error-text" id={errorId}>
          {error}
        </p>
      ) : null}
      <input
        id={id}
        name={name}
        className="input"
        type="text"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...input}
      />
    </div>
  );
}
