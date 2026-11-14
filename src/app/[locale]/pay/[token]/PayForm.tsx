"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Appearance, Stripe, StripeElements, StripePaymentElement } from "@stripe/stripe-js";
import { loadStripe } from "@stripe/stripe-js/pure";
import { fill, formatMoney, type Locale } from "@/lib/i18n";
import { confirmPayment, finishPayment, reviewPayment, type PayResult, type Problem, type Quote } from "./actions";
import styles from "./pay.module.css";

interface Labels {
  amountDue: string;
  failed: string;
  howTitle: string;
  feeNote: string;
  review: string;
  checking: string;
  checkTitle: string;
  orderTotal: string;
  cardFee: string;
  youPay: string;
  payButton: string;
  paying: string;
  change: string;
  paidTitle: string;
  paidLabel: string;
  processingTitle: string;
  processingBody: string;
  declined: string;
  error: string;
  changed: string;
  expired: string;
  loadFailed: string;
  testMode: string;
}

/**
 *   loading     Stripe's form is on its way
 *   form        the customer picks bank or card and enters it
 *   checking    the server works out what that comes to (a fee on credit cards only)
 *   review      the customer sees the amount, fee included, before paying
 *   paying      the payment is being made (and the bank or card may ask them to confirm)
 *   paid, processing   done: the money is in, or a bank payment is on its way
 *   broken      Stripe's form did not load
 */
type Step = "loading" | "form" | "checking" | "review" | "paying" | "paid" | "processing" | "broken";

/** Stripe's form in the site's colors. Its fields sit in Stripe's own frames, which keep their own font. */
const APPEARANCE: Appearance = {
  theme: "stripe",
  variables: {
    colorPrimary: "#5b2a86",
    colorText: "#23172e",
    colorTextSecondary: "#554863",
    colorDanger: "#a3241c",
    colorBackground: "#ffffff",
    borderRadius: "10px",
    fontSizeBase: "16px",
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  },
};

/**
 * Paying with Stripe's Payment Element: card or US bank account (linked through the bank's
 * own sign-in). Nothing is charged until the customer has seen the amount with any card fee
 * and pressed Pay; the server works out that amount and makes the payment.
 */
export function PayForm({
  locale,
  token,
  publishableKey,
  testMode,
  dueCents,
  lastFailed,
  titleId,
  labels,
}: {
  locale: Locale;
  token: string;
  publishableKey: string;
  testMode: boolean;
  dueCents: number;
  /** The order's last payment did not go through. */
  lastFailed: boolean;
  /** The id the page's section is labelled by: given to the heading of the step on show. */
  titleId: string;
  labels: Labels;
}) {
  const host = useRef<HTMLDivElement>(null);
  const stripe = useRef<Stripe | null>(null);
  const elements = useRef<StripeElements | null>(null);
  const confirmation = useRef<string | null>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const lastStep = useRef<Step>("loading");
  const [step, setStep] = useState<Step>("loading");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let element: StripePaymentElement | null = null;
    let gone = false;
    loadStripe(publishableKey)
      .then((s) => {
        if (gone || !host.current) return;
        if (!s) throw new Error("Stripe.js did not start");
        stripe.current = s;
        const e = s.elements({
          mode: "payment",
          amount: dueCents,
          currency: "usd",
          allowedPaymentMethodTypes: ["card", "us_bank_account"],
          // The same as the server asks: bank accounts are linked through the bank's own sign-in.
          paymentMethodOptions: { us_bank_account: { verification_method: "instant" } },
          locale,
          appearance: APPEARANCE,
        });
        elements.current = e;
        element = e.create("payment", {
          layout: { type: "tabs" },
          // Apple Pay and Google Pay show the amount before we know whether the card is a credit card.
          wallets: { applePay: "never", googlePay: "never", link: "never" },
        });
        element.on("ready", () => {
          if (!gone) setStep((now) => (now === "loading" ? "form" : now));
        });
        element.on("loaderror", () => {
          if (!gone) setStep("broken");
        });
        element.mount(host.current);
      })
      .catch(() => {
        if (!gone) setStep("broken");
      });
    return () => {
      gone = true;
      element?.destroy();
    };
  }, [publishableKey, dueCents, locale]);

  // Focus follows the step: to its heading when one opens, back to the form when it returns.
  useEffect(() => {
    const before = lastStep.current;
    lastStep.current = step;
    if (step === before) return;
    if (step === "review" || step === "paid" || step === "processing") stepHeading.current?.focus();
    else if (step === "form" && (before === "review" || before === "paying")) formHeading.current?.focus();
  }, [step]);

  const money = (cents: number) => formatMoney(locale, cents / 100);

  /** Why a step could not go on, said in the page; or a reload when the order itself changed. */
  function problem(reason: Problem, next?: Quote) {
    if (reason === "paid" || reason === "processing" || reason === "closed") {
      window.location.reload();
      return;
    }
    if (reason === "changed" && next) {
      setQuote(next);
      setError(labels.changed);
      setStep("review");
      return;
    }
    setError(reason === "declined" ? labels.declined : reason === "expired" ? labels.expired : labels.error);
    confirmation.current = null;
    setQuote(null);
    setStep("form");
  }

  async function review(event: FormEvent) {
    event.preventDefault();
    const s = stripe.current;
    const e = elements.current;
    if (!s || !e || step !== "form") return;
    setError(null);
    setStep("checking");
    // Stripe's form says what is missing in its own fields.
    const submitted = await e.submit();
    if (submitted.error) {
      if (submitted.error.type !== "validation_error") setError(submitted.error.message ?? labels.error);
      setStep("form");
      return;
    }
    const made = await s.createConfirmationToken({ elements: e });
    if (made.error || !made.confirmationToken) {
      setError(made.error?.message ?? labels.error);
      setStep("form");
      return;
    }
    const answer = await reviewPayment({ locale, token, confirmationToken: made.confirmationToken.id }).catch(() => null);
    if (!answer) return problem("generic");
    if (!answer.ok) return problem(answer.reason);
    confirmation.current = made.confirmationToken.id;
    setQuote(answer.quote);
    setStep("review");
  }

  async function pay() {
    const s = stripe.current;
    if (!s || !quote || !confirmation.current || step !== "review") return;
    setError(null);
    setStep("paying");
    let result: PayResult | null = await confirmPayment({
      locale,
      token,
      confirmationToken: confirmation.current,
      totalCents: quote.totalCents,
    }).catch(() => null);
    if (result?.ok && result.status === "action") {
      // The bank or card asks the customer to confirm (3D Secure); then the server reads where it stands.
      await s.handleNextAction({ clientSecret: result.clientSecret }).catch(() => null);
      result = await finishPayment({ locale, token, intentId: result.intentId }).catch(() => null);
    }
    if (!result) return problem("generic");
    if (!result.ok) return problem(result.reason, result.quote);
    if (result.status === "action") return problem("generic");
    confirmation.current = null;
    setStep(result.status);
  }

  function changeMethod() {
    confirmation.current = null;
    setQuote(null);
    setError(null);
    setStep("form");
  }

  const onForm = step === "loading" || step === "form" || step === "checking" || step === "broken";
  const amounts = quote ? (
    <dl className={styles.quote}>
      <div>
        <dt>{labels.orderTotal}</dt>
        <dd>
          <bdi>{money(quote.dueCents)}</bdi>
        </dd>
      </div>
      {quote.feeCents > 0 ? (
        <div>
          <dt>{labels.cardFee}</dt>
          <dd>
            <bdi>{money(quote.feeCents)}</bdi>
          </dd>
        </div>
      ) : null}
      <div className={styles.quoteTotal}>
        <dt>{step === "paid" ? labels.paidLabel : labels.youPay}</dt>
        <dd>
          <bdi>{money(quote.totalCents)}</bdi>
        </dd>
      </div>
    </dl>
  ) : null;

  const done = (step === "paid" || step === "processing") && quote;
  return (
    <>
      {!done ? (
        <>
          <p className={styles.due}>
            <span>{labels.amountDue}</span>
            <bdi>{money(dueCents)}</bdi>
          </p>
          {lastFailed ? <p className={styles.problem}>{labels.failed}</p> : null}
        </>
      ) : null}
      {done ? (
        <div className={`${styles.step} ${styles.done}`} data-state={step} role="status">
          <h2 className="h3" id={titleId} ref={stepHeading} tabIndex={-1}>
            {step === "paid" ? labels.paidTitle : labels.processingTitle}
          </h2>
          {step === "processing" ? <p>{labels.processingBody}</p> : null}
          {amounts}
          <p className={styles.method}>{quote.label}</p>
        </div>
      ) : null}

      {(step === "review" || step === "paying") && quote ? (
        <div className={styles.step}>
          <h2 className="h3" id={titleId} ref={stepHeading} tabIndex={-1}>
            {labels.checkTitle}
          </h2>
          <p className={styles.method}>{quote.label}</p>
          {amounts}
          {error ? (
            <p className={styles.problem} role="alert">
              {error}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button type="button" className="btn" onClick={pay} disabled={step === "paying"}>
              {step === "paying" ? labels.paying : fill(labels.payButton, { amount: money(quote.totalCents) })}
            </button>
            <button type="button" className="btn btn-quiet" onClick={changeMethod} disabled={step === "paying"}>
              {labels.change}
            </button>
          </div>
        </div>
      ) : null}

      {/* Stays in the page while hidden, so Stripe's form keeps what was entered. */}
      <form className={styles.step} onSubmit={review} hidden={!onForm} noValidate>
        <h2 className="h3" id={onForm ? titleId : undefined} ref={formHeading} tabIndex={-1}>
          {labels.howTitle}
        </h2>
        {testMode ? <p className={styles.test}>{labels.testMode}</p> : null}
        <p className="small muted">{labels.feeNote}</p>
        <div ref={host} className={styles.element} data-loading={step === "loading" ? "" : undefined} />
        {step === "broken" ? (
          <p className={styles.problem} role="alert">
            {labels.loadFailed}
          </p>
        ) : error && onForm ? (
          <p className={styles.problem} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button type="submit" className="btn" disabled={step !== "form"}>
            {step === "checking" ? labels.checking : labels.review}
          </button>
        </div>
      </form>
    </>
  );
}
