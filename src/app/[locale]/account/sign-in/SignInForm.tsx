"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import type { Dict } from "@/i18n";
import { fill, type Locale } from "@/lib/i18n";
import { passwordSignIn, sendCode, verifyCode, type PasswordState, type SignInState } from "../actions";
import styles from "../account.module.css";

/**
 * signin: email and password, or a code by email.
 * create: a new account. A code proves the email, then they choose a password.
 * reset:  a signed-in customer changes their password, again behind a fresh code.
 */
export type SignInMode = "signin" | "create" | "reset";

export function SignInForm({
  locale,
  next,
  labels,
  optional,
  mode,
  startWithCode,
  knownEmail,
  createHref,
  createLabel,
}: {
  locale: Locale;
  next: string | null;
  labels: Dict["signIn"];
  /** The word "optional", for the password field of a plain code sign-in. */
  optional: string;
  mode: SignInMode;
  /** Open on the code form instead of the password form. */
  startWithCode: boolean;
  /** The signed-in customer's email, when they are changing their password. */
  knownEmail: string | null;
  createHref: string;
  /** "Create account", on the last button of a new account's code step. */
  createLabel: string;
}) {
  const [sent, sendAction, sending] = useActionState<SignInState, FormData>(sendCode, { step: "email", email: "" });
  const [checked, verifyAction, verifying] = useActionState<SignInState, FormData>(verifyCode, { step: "code", email: "" });
  const [signed, passwordAction, signingIn] = useActionState<PasswordState, FormData>(passwordSignIn, { email: "" });
  const [view, setView] = useState<"password" | "email" | "code">(mode === "signin" && !startWithCode ? "password" : "email");
  // What they typed stays put when they move between the password form and the code form.
  const [typed, setTyped] = useState(knownEmail ?? "");
  const heading = useRef<HTMLHeadingElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const newPasswordInput = useRef<HTMLInputElement>(null);

  // Move to the code step once a code is on its way, and put focus where the reader is.
  useEffect(() => {
    if (sent.step === "code") setView("code");
  }, [sent]);
  useEffect(() => {
    if (view === "code") heading.current?.focus();
  }, [view]);
  useEffect(() => {
    if (checked.error === "passwordLength") newPasswordInput.current?.focus();
    else if (checked.error) codeInput.current?.focus();
  }, [checked]);
  useEffect(() => {
    if (signed.error === "email") emailInput.current?.focus();
    else if (signed.error) passwordInput.current?.focus();
  }, [signed]);

  const t = labels;
  const locked = mode === "reset";

  const emailField = (error: string | null, invalid: boolean) => (
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
        ref={emailInput}
        id="si-email"
        name="email"
        type="email"
        className={`input ${locked ? styles.locked : ""}`}
        // "username" is what password managers file the password under.
        autoComplete="username"
        inputMode="email"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        readOnly={locked}
        maxLength={160}
        required
        aria-invalid={invalid ? true : undefined}
        aria-describedby={error ? "si-email-error" : undefined}
      />
    </div>
  );

  const trap = (
    <div className={styles.trap} aria-hidden="true">
      <label htmlFor="si-website">Website</label>
      <input id="si-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
    </div>
  );

  if (view === "password") {
    const emailError = signed.error === "email" ? t.errors.email : null;
    const error = signed.error && signed.error !== "email" ? t.errors[signed.error] : null;
    return (
      <div className={styles.signIn}>
        <h1 className="h2">{t.title}</h1>
        <p className="lede">{t.passwordLede}</p>
        <form action={passwordAction} className={styles.form} noValidate>
          <input type="hidden" name="locale" value={locale} />
          {next ? <input type="hidden" name="next" value={next} /> : null}
          {trap}
          {emailField(emailError, Boolean(emailError))}
          <div className="field">
            <label className="label" htmlFor="si-password">
              {t.password}
            </label>
            {error ? (
              <p className="error-text" id="si-password-error" role="alert">
                {error}
              </p>
            ) : null}
            <input
              ref={passwordInput}
              id="si-password"
              name="password"
              type="password"
              className="input"
              autoComplete="current-password"
              maxLength={200}
              required
              aria-invalid={signed.error === "password" ? true : undefined}
              aria-describedby={error ? "si-password-error" : undefined}
            />
          </div>
          <div className={styles.row}>
            <button type="submit" className="btn" disabled={signingIn}>
              {signingIn ? t.verifying : t.verify}
            </button>
            <button type="button" className={styles.textButton} onClick={() => setView("email")}>
              {t.useCode}
            </button>
          </div>
        </form>
        <p className={styles.help}>
          {t.newHere} <Link href={createHref}>{t.request}</Link>
        </p>
      </div>
    );
  }

  if (view === "email") {
    const error = sent.error ? t.errors[sent.error] : null;
    return (
      <div className={styles.signIn}>
        <h1 className="h2">{mode === "create" ? t.createTitle : mode === "reset" ? t.resetTitle : t.title}</h1>
        <p className="lede">
          {mode === "create" ? t.createLede : mode === "reset" ? fill(t.resetLede, { email: typed }) : t.lede}
        </p>
        <form action={sendAction} className={styles.form} noValidate>
          <input type="hidden" name="locale" value={locale} />
          {trap}
          {emailField(error, sent.error === "email")}
          <div className={styles.row}>
            <button type="submit" className="btn" disabled={sending}>
              {sending ? t.sending : t.sendCode}
            </button>
            {mode === "signin" ? (
              <button type="button" className={styles.textButton} onClick={() => setView("password")}>
                {t.usePassword}
              </button>
            ) : null}
          </div>
        </form>
      </div>
    );
  }

  const email = sent.email;
  const mine = checked.email === email;
  const codeError = mine && checked.error && checked.error !== "passwordLength" ? t.errors[checked.error] : null;
  const passwordError = mine && checked.error === "passwordLength" ? t.errors.passwordLength : null;
  const resendError = sent.error === "wait" || sent.error === "generic" ? t.errors[sent.error] : null;
  return (
    <div className={styles.signIn}>
      <h1 className="h2" ref={heading} tabIndex={-1}>
        {t.codeTitle}
      </h1>
      <p className="lede">{fill(t.codeSent, { email })}</p>
      <form action={verifyAction} className={styles.form} noValidate>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="mode" value={mode} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {/* In the form and readable, so a password manager saves the new password under this email. */}
        <div className="field">
          <label className="label" htmlFor="si-code-email">
            {t.email}
          </label>
          <input
            id="si-code-email"
            name="email"
            type="email"
            className={`input ${styles.locked}`}
            autoComplete="username"
            value={email}
            readOnly
          />
        </div>
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
        <div className="field">
          <label className="label" htmlFor="si-new-password">
            {mode === "create" ? t.choosePassword : t.newPassword}
            {mode === "signin" ? <span className="optional"> ({optional})</span> : null}
          </label>
          <p className="hint" id="si-new-password-hint">
            {mode === "signin" ? t.passwordOptionalHint : t.passwordHint}
          </p>
          {passwordError ? (
            <p className="error-text" id="si-new-password-error" role="alert">
              {passwordError}
            </p>
          ) : null}
          <input
            ref={newPasswordInput}
            id="si-new-password"
            name="password"
            type="password"
            className="input"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            required={mode !== "signin"}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={passwordError ? "si-new-password-hint si-new-password-error" : "si-new-password-hint"}
          />
        </div>
        <div className={styles.row}>
          <button type="submit" className="btn" disabled={verifying}>
            {verifying ? t.verifying : mode === "reset" ? t.savePassword : mode === "create" ? createLabel : t.verify}
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
        {locked ? null : (
          <button type="button" className={styles.textButton} onClick={() => setView("email")}>
            {t.changeEmail}
          </button>
        )}
      </div>
      <p className={styles.status} aria-live="polite">
        {resendError ?? (sent.resent && !sending ? t.resent : "")}
      </p>
    </div>
  );
}
