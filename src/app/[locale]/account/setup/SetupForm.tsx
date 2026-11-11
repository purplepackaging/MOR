"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { LoopMark } from "@/components/Wordmark";
import type { Dict } from "@/i18n";
import { fill, languageNames, locales, type Locale } from "@/lib/i18n";
import { BUSINESS_TYPES, type SetupKey } from "@/lib/request-validation";
import { createAccount, type SetupState } from "../actions";
import shared from "../../request-account/request.module.css";
import { TextField, checkSetup, focusFirst, type Errors } from "./fields";
import styles from "./setup.module.css";

interface Props {
  locale: Locale;
  next: string | null;
  email: string;
  rep: { code: string; name: string } | null;
  t: Dict["setup"];
  r: Dict["request"];
  hrefs: { sms: string; privacy: string };
}

/**
 * The business form: what we need to deliver, and nothing else on the way.
 * Fields are checked here before they go to the server, and whatever was typed
 * stays in the form when the server finds a problem.
 */
export function SetupForm({ locale, next, email, rep, t, r, hrefs }: Props) {
  const [state, action, pending] = useActionState<SetupState, FormData>(createAccount, {});
  const formRef = useRef<HTMLFormElement>(null);
  // Problems found in the browser. They stand until the server answers again.
  const [local, setLocal] = useState<{ since: SetupState; errors: Errors } | null>(null);
  const checkedHere = local && local.since === state ? local.errors : null;
  const errors: Errors = checkedHere ?? state.errors ?? {};
  const kept = state.values;
  const keptOptional = Boolean(kept && (kept.businessType || kept.repCode || (kept.language && kept.language !== locale)));

  // The server found a problem: go to the first one.
  useEffect(() => {
    focusFirst(formRef.current, state.errors);
  }, [state]);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    const found = checkSetup(event.currentTarget);
    if (Object.keys(found).length === 0) return;
    // Nothing is sent, so nothing typed is lost.
    event.preventDefault();
    setLocal({ since: state, errors: found });
    focusFirst(event.currentTarget, found);
  };

  // A message goes away as soon as its field is right. New messages wait for the button,
  // so nothing moves on the page while someone is reaching for it.
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
  const field = (name: SetupKey) => ({ name, label: r[name], error: errorText(name), defaultValue: kept?.[name] });
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <div className={styles.wrap}>
      <header className={shared.head}>
        <h1 className="h2">{t.title}</h1>
        <p className="lede">{t.lede}</p>
        <p className="small muted">
          <bdi>{fill(t.signedInAs, { email })}</bdi>
        </p>
        {rep ? (
          <p className={shared.rep}>
            <LoopMark className={shared.repMark} />
            {fill(r.repBanner, { rep: rep.name })}
          </p>
        ) : null}
      </header>

      <form ref={formRef} action={action} className={styles.form} noValidate onSubmit={onSubmit} onChange={onChange}>
        <input type="hidden" name="locale" value={locale} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {rep ? <input type="hidden" name="repCode" value={rep.code} /> : null}
        <div className={shared.trap} aria-hidden="true">
          <label htmlFor="su-website">Website</label>
          <input id="su-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

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
          hint={t.phoneHint}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={20}
          required
        />

        <div className={`${shared.consent} ${styles.consent}`}>
          <input
            id="su-sms"
            name="smsConsent"
            type="checkbox"
            className={shared.check}
            defaultChecked={kept?.smsConsent ?? false}
          />
          <div>
            <label htmlFor="su-sms" className={shared.consentText}>
              {r.sms}
            </label>
            <p className={shared.consentLinks}>
              <Link className="link" href={hrefs.sms}>
                {r.smsTerms}
              </Link>
              <Link className="link" href={hrefs.privacy}>
                {r.privacy}
              </Link>
            </p>
          </div>
        </div>

        {/* Nothing in here is needed to deliver, so it stays out of the way until someone wants it. */}
        <details className={styles.more} open={keptOptional || undefined}>
          <summary>
            {t.more}
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className={styles.moreFields}>
            <div className="field">
              <label className="label" htmlFor="su-businessType">
                {r.businessType}
              </label>
              {/* The key gives the select a fresh start when the server sends the form back: a select
                  keeps its first default through a form reset, so it would lose the choice otherwise. */}
              <select
                key={kept?.businessType ?? ""}
                id="su-businessType"
                name="businessType"
                className="input"
                defaultValue={kept?.businessType ?? ""}
              >
                <option value="">{r.choose}</option>
                {BUSINESS_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {r.types[type]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="su-language">
                {r.language}
              </label>
              <select
                key={kept?.language || locale}
                id="su-language"
                name="language"
                className="input"
                defaultValue={kept?.language || locale}
              >
                {locales.map((l) => (
                  <option key={l} value={l}>
                    {languageNames[l]}
                  </option>
                ))}
              </select>
            </div>
            {rep ? null : (
              <div className={`field ${shared.short}`}>
                <label className="label" htmlFor="su-repCode">
                  {r.repCode}
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
                  defaultValue={kept?.repCode}
                />
              </div>
            )}
          </div>
        </details>

        <div className={styles.submitRow}>
          {state.failed && !checkedHere ? (
            <p className={shared.failure} role="alert">
              {t.failed}
            </p>
          ) : hasErrors ? (
            <p className={shared.failure} role="alert">
              {r.errors.summary}
            </p>
          ) : null}
          <button type="submit" className={`btn ${styles.submit}`} disabled={pending}>
            {pending ? (
              <>
                <LoaderCircle className={shared.spin} aria-hidden="true" />
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
