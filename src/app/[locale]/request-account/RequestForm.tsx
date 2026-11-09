"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { LoopMark } from "@/components/Wordmark";
import type { Dict } from "@/i18n";
import { fill, languageNames, locales, plural, type Locale } from "@/lib/i18n";
import { listStore, useHydrated, useList } from "@/lib/list-store";
import {
  BUSINESS_TYPES,
  CHANNELS,
  validateRequest,
  valuesFromForm,
  type ErrorCode,
  type FieldKey,
} from "@/lib/request-validation";
import { submitAccountRequest, type SubmitResult } from "./actions";
import styles from "./request.module.css";

type Errors = Partial<Record<FieldKey, ErrorCode>>;

/** Order used to move focus to the first problem. Matches the order on screen. */
const FIELD_ORDER: FieldKey[] = ["businessName", "businessType", "street", "city", "zip", "contactName", "phone", "email"];

interface Props {
  locale: Locale;
  t: Dict["request"];
  rep: { code: string; name: string } | null;
  hrefs: { list: string; products: string; sms: string; privacy: string };
}

export function RequestForm({ locale, t, rep, hrefs }: Props) {
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<"notReady" | "generic" | null>(null);
  const [done, setDone] = useState<{ name: string; phone: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const hydrated = useHydrated();
  const lines = useList();

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  const errorText = (key: FieldKey): string | undefined => {
    const code = errors[key];
    if (!code) return undefined;
    if (code === "required") {
      const field = t.fieldNames[key as keyof typeof t.fieldNames] ?? key;
      return fill(t.errors.required, { field });
    }
    return t.errors[code];
  };

  const focusFirst = (errs: Errors) => {
    const first = FIELD_ORDER.find((k) => errs[k]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const form = new FormData(e.currentTarget);
    const { errors: found } = validateRequest(valuesFromForm(form));
    setFailure(null);
    if (Object.keys(found).length) {
      setErrors(found);
      focusFirst(found);
      return;
    }
    setErrors({});
    form.set("items", JSON.stringify(lines));
    startTransition(async () => {
      let result: SubmitResult;
      try {
        result = await submitAccountRequest(form);
      } catch {
        result = { ok: false, reason: "generic" };
      }
      if (result.ok) {
        listStore.clear();
        setDone({ name: result.name, phone: result.phone });
        window.scrollTo({ top: 0 });
      } else if (result.reason === "invalid") {
        setErrors(result.errors);
        focusFirst(result.errors);
      } else {
        setFailure(result.reason);
      }
    });
  };

  // Clear a field's error as soon as the person changes it.
  const onChange = (e: React.FormEvent<HTMLFormElement>) => {
    const name = (e.target as HTMLInputElement).name as FieldKey;
    if (!errors[name]) return;
    setErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  if (done) {
    return (
      <div className={styles.done}>
        <span className={styles.doneMark} aria-hidden="true">
          <Check />
        </span>
        <h1 className="h2" ref={doneRef} tabIndex={-1}>
          {t.successTitle}
        </h1>
        <p className="lede">{fill(t.successBody, done)}</p>
        <div>
          <Link className="btn" href={hrefs.products}>
            {t.successBrowse}
          </Link>
        </div>
      </div>
    );
  }

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <div className={styles.formWrap}>
      <header className={styles.head}>
        <h1 className="h2">{t.title}</h1>
        <p className="lede">{t.lede}</p>
        {rep ? (
          <p className={styles.rep}>
            <LoopMark className={styles.repMark} />
            {fill(t.repBanner, { rep: rep.name })}
          </p>
        ) : null}
      </header>

      <form ref={formRef} className={styles.form} onSubmit={onSubmit} onChange={onChange} noValidate>
        <input type="hidden" name="siteLocale" value={locale} />
        {rep ? <input type="hidden" name="repCode" value={rep.code} /> : null}
        <div className={styles.trap} aria-hidden="true">
          <label htmlFor="rq-website">Website</label>
          <input id="rq-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>{t.business}</legend>
          <TextField
            name="businessName"
            label={t.businessName}
            error={errorText("businessName")}
            autoComplete="organization"
            maxLength={120}
            required
          />
          <div className="field">
            <label className="label" htmlFor="rq-businessType">
              {t.businessType}
            </label>
            {errors.businessType ? (
              <p className="error-text" id="rq-businessType-error">
                {errorText("businessType")}
              </p>
            ) : null}
            <select
              id="rq-businessType"
              name="businessType"
              className="input"
              defaultValue=""
              required
              aria-invalid={errors.businessType ? true : undefined}
              aria-describedby={errors.businessType ? "rq-businessType-error" : undefined}
            >
              <option value="" disabled>
                {t.choose}
              </option>
              {BUSINESS_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t.types[type]}
                </option>
              ))}
            </select>
          </div>
          <TextField
            name="street"
            label={t.street}
            error={errorText("street")}
            autoComplete="address-line1"
            maxLength={160}
            required
          />
          <div className={styles.pair}>
            <TextField
              name="city"
              label={t.city}
              error={errorText("city")}
              autoComplete="address-level2"
              maxLength={80}
              required
            />
            <TextField
              name="zip"
              label={t.zip}
              error={errorText("zip")}
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
          <legend className={styles.legend}>{t.contact}</legend>
          <TextField
            name="contactName"
            label={t.contactName}
            error={errorText("contactName")}
            autoComplete="name"
            maxLength={80}
            required
          />
          <TextField
            name="phone"
            label={t.phone}
            hint={t.phoneHint}
            error={errorText("phone")}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            required
          />
          <TextField
            name="email"
            label={t.email}
            optionalLabel={t.optional}
            error={errorText("email")}
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={160}
          />
          <div className="field">
            <label className="label" htmlFor="rq-language">
              {t.language}
            </label>
            <select id="rq-language" name="language" className="input" defaultValue={locale}>
              {locales.map((l) => (
                <option key={l} value={l}>
                  {languageNames[l]}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.consent}>
            <input id="rq-sms" name="smsConsent" type="checkbox" className={styles.check} />
            <div>
              <label htmlFor="rq-sms" className={styles.consentText}>
                {t.sms}
              </label>
              <p className={styles.consentLinks}>
                <Link className="link" href={hrefs.sms}>
                  {t.smsTerms}
                </Link>
                <Link className="link" href={hrefs.privacy}>
                  {t.privacy}
                </Link>
              </p>
            </div>
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>{t.ordering}</legend>
          <fieldset className={styles.choices}>
            <legend className="label">
              {t.channels} <span className="optional">({t.optional})</span>
            </legend>
            <div className={styles.choiceRow}>
              {CHANNELS.map((c) => (
                <label key={c} className={styles.choice}>
                  <input type="checkbox" name="channels" value={c} />
                  <span>{t.channelOptions[c]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {rep ? null : (
            <TextField
              name="repCode"
              label={t.repCode}
              optionalLabel={t.optional}
              hint={t.repCodeHint}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={12}
              className={styles.short}
            />
          )}
          <div className="field">
            <label className="label" htmlFor="rq-notes">
              {t.notes} <span className="optional">({t.optional})</span>
            </label>
            <p className="hint" id="rq-notes-hint">
              {t.notesHint}
            </p>
            <textarea id="rq-notes" name="notes" className="input" rows={4} maxLength={1000} aria-describedby="rq-notes-hint" />
          </div>
          {hydrated && lines.length > 0 ? (
            <p className={styles.listNote}>
              {plural(locale, lines.length, t.listIncluded)}{" "}
              <Link className="link" href={hrefs.list}>
                {t.editList}
              </Link>
            </p>
          ) : null}
        </fieldset>

        <div className={styles.submitRow}>
          {failure ? (
            <p className={styles.failure} role="alert">
              {failure === "notReady" ? t.errors.notReady : t.errors.generic}
            </p>
          ) : hasErrors ? (
            <p className={styles.failure}>{t.errors.summary}</p>
          ) : null}
          <button type="submit" className={`btn ${styles.submit}`} disabled={pending}>
            {pending ? (
              <>
                <LoaderCircle className={styles.spin} aria-hidden="true" />
                {t.sending}
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
  optionalLabel,
  className,
  ...input
}: {
  name: FieldKey | "repCode";
  label: string;
  hint?: string;
  error?: string;
  /** Pass the word for "optional" to mark the field as optional. */
  optionalLabel?: string;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "id" | "className">) {
  const id = `rq-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${className ?? ""}`}>
      <label className="label" htmlFor={id}>
        {label}
        {optionalLabel ? <span className="optional"> ({optionalLabel})</span> : null}
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
