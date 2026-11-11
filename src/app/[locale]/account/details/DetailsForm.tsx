"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { Dict } from "@/i18n";
import { fill, languageNames, locales, type Locale } from "@/lib/i18n";
import type { SetupKey } from "@/lib/request-validation";
import { updateDetails, type DetailsState } from "../actions";
import shared from "../../request-account/request.module.css";
import { TextField, checkSetup, focusFirst, type Errors } from "../setup/fields";
import styles from "../setup/setup.module.css";

interface Props {
  locale: Locale;
  /** What is on file now. The phone is already written the way people type it. */
  details: Record<SetupKey, string> & { language: Locale };
  backHref: string;
  labels: { title: string; lede: string; save: string; saving: string; failed: string; back: string; phoneHint: string };
  r: Dict["request"];
}

/**
 * The owner corrects the business details. Same fields and same rules as the
 * form a new customer fills in: checked here first, kept when something is wrong.
 */
export function DetailsForm({ locale, details, backHref, labels, r }: Props) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(updateDetails, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [local, setLocal] = useState<{ since: DetailsState; errors: Errors } | null>(null);
  const checkedHere = local && local.since === state ? local.errors : null;
  const errors: Errors = checkedHere ?? state.errors ?? {};
  const kept = state.values;

  useEffect(() => {
    focusFirst(formRef.current, state.errors);
  }, [state]);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    const found = checkSetup(event.currentTarget);
    if (Object.keys(found).length === 0) return;
    event.preventDefault();
    setLocal({ since: state, errors: found });
    focusFirst(event.currentTarget, found);
  };

  const onChange = (event: React.FormEvent<HTMLFormElement>) => {
    const name = (event.target as unknown as HTMLInputElement).name as SetupKey;
    if (!errors[name]) return;
    const found = checkSetup(event.currentTarget)[name];
    if (found === errors[name]) return;
    const rest = { ...errors };
    if (found) rest[name] = found;
    else delete rest[name];
    setLocal({ since: state, errors: rest });
  };

  const errorText = (key: SetupKey): string | undefined => {
    const code = errors[key];
    if (!code) return undefined;
    if (code === "required") return fill(r.errors.required, { field: r.fieldNames[key] });
    return r.errors[code];
  };
  const field = (name: SetupKey) => ({
    name,
    label: r[name],
    error: errorText(name),
    defaultValue: kept?.[name] ?? details[name],
  });
  const language = kept?.language || details.language;

  return (
    <div className={styles.wrap}>
      <header className={shared.head}>
        <p className="small">
          <Link href={backHref}>{labels.back}</Link>
        </p>
        <h1 className="h2">{labels.title}</h1>
        <p className="lede">{labels.lede}</p>
      </header>

      <form ref={formRef} action={action} className={styles.form} noValidate onSubmit={onSubmit} onChange={onChange}>
        <input type="hidden" name="locale" value={locale} />
        <TextField {...field("businessName")} autoComplete="organization" maxLength={120} required />
        <TextField {...field("street")} autoComplete="address-line1" maxLength={160} required />
        <div className={styles.pair}>
          <TextField {...field("city")} autoComplete="address-level2" maxLength={80} required />
          <TextField
            {...field("zip")}
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={10}
            spellCheck={false}
            required
          />
        </div>
        <TextField {...field("contactName")} autoComplete="name" maxLength={80} required />
        <TextField
          {...field("phone")}
          hint={labels.phoneHint}
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
          {/* The key lets the select take a new default after the form is sent back (see SetupForm). */}
          <select key={language} id="su-language" name="language" className="input" defaultValue={language}>
            {locales.map((l) => (
              <option key={l} value={l}>
                {languageNames[l]}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.submitRow}>
          {state.failed && !checkedHere ? (
            <p className={shared.failure} role="alert">
              {labels.failed}
            </p>
          ) : Object.keys(errors).length > 0 ? (
            <p className={shared.failure} role="alert">
              {r.errors.summary}
            </p>
          ) : null}
          <button type="submit" className={`btn ${styles.submit}`} disabled={pending}>
            {pending ? (
              <>
                <LoaderCircle className={shared.spin} aria-hidden="true" />
                {labels.saving}
              </>
            ) : (
              labels.save
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
