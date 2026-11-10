"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { Dict } from "@/i18n";
import { fill, type Locale } from "@/lib/i18n";
import { sendCode, verifyCode, type SignInState } from "../actions";
import styles from "../account.module.css";

export function SignInForm({
  locale,
  next,
  labels,
  create,
}: {
  locale: Locale;
  next: string | null;
  labels: Dict["signIn"];
  /** Came to create an account: same form, different heading. */
  create: boolean;
}) {
  const [sent, sendAction, sending] = useActionState<SignInState, FormData>(sendCode, { step: "email", email: "" });
  const [checked, verifyAction, verifying] = useActionState<SignInState, FormData>(verifyCode, { step: "code", email: "" });
  const [step, setStep] = useState<"email" | "code">("email");
  const heading = useRef<HTMLHeadingElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  // Move to the code step once a code is on its way, and put focus where the reader is.
  useEffect(() => {
    if (sent.step === "code") setStep("code");
  }, [sent]);
  useEffect(() => {
    if (step === "code") heading.current?.focus();
  }, [step]);
  useEffect(() => {
    if (checked.error) codeInput.current?.focus();
  }, [checked]);

  const email = sent.email;
  const t = labels;

  if (step === "email") {
    const error = sent.error ? t.errors[sent.error] : null;
    return (
      <div className={styles.signIn}>
        <h1 className="h2">{create ? t.createTitle : t.title}</h1>
        <p className="lede">{create ? t.createLede : t.lede}</p>
        <form action={sendAction} className={styles.form} noValidate>
          <input type="hidden" name="locale" value={locale} />
          <div className={styles.trap} aria-hidden="true">
            <label htmlFor="si-website">Website</label>
            <input id="si-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>
          <div className="field">
            <label className="label" htmlFor="si-email">
              {t.email}
            </label>
            {error ? (
              <p className="error-text" id="si-email-error" role="alert">
                {error}
              </p>
            ) : null}
            <input
              id="si-email"
              name="email"
              type="email"
              className="input"
              autoComplete="email"
              inputMode="email"
              defaultValue={email}
              maxLength={160}
              required
              aria-invalid={sent.error === "email" ? true : undefined}
              aria-describedby={error ? "si-email-error" : undefined}
            />
          </div>
          <div className={styles.row}>
            <button type="submit" className="btn" disabled={sending}>
              {sending ? t.sending : t.sendCode}
            </button>
          </div>
        </form>
      </div>
    );
  }

  const codeError = checked.email === email && checked.error ? t.errors[checked.error] : null;
  const resendError = sent.error === "wait" || sent.error === "generic" ? t.errors[sent.error] : null;
  return (
    <div className={styles.signIn}>
      <h1 className="h2" ref={heading} tabIndex={-1}>
        {t.codeTitle}
      </h1>
      <p className="lede">{fill(t.codeSent, { email })}</p>
      <form action={verifyAction} className={styles.form} noValidate>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="email" value={email} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <div className="field">
          <label className="label" htmlFor="si-code">
            {t.code}
          </label>
          {codeError ? (
            <p className="error-text" id="si-code-error" role="alert">
              {codeError}
            </p>
          ) : null}
          <input
            ref={codeInput}
            id="si-code"
            name="code"
            className={`input ${styles.code}`}
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={10}
            required
            dir="ltr"
            aria-invalid={codeError ? true : undefined}
            aria-describedby={codeError ? "si-code-error" : undefined}
          />
        </div>
        <div className={styles.row}>
          <button type="submit" className="btn" disabled={verifying}>
            {verifying ? t.verifying : t.verify}
          </button>
        </div>
      </form>
      <div className={styles.row}>
        <form action={sendAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="email" value={email} />
          <button type="submit" className={styles.textButton} disabled={sending}>
            {sending ? t.sending : t.resend}
          </button>
        </form>
        <button type="button" className={styles.textButton} onClick={() => setStep("email")}>
          {t.changeEmail}
        </button>
      </div>
      <p className={styles.status} aria-live="polite">
        {resendError ?? (sent.resent && !sending ? t.resent : "")}
      </p>
    </div>
  );
}
