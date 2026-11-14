"use server";

import { getDictionary } from "@/i18n";
import { fill, isLocale, isolate, type Locale } from "@/lib/i18n";
import { getPayOrder, isPayToken, payPath, payState, recordPayment, siteOrigin, type PayOrder } from "@/lib/payments";
import {
  StripeError,
  cardFeeCents,
  createPayment,
  getConfirmationToken,
  getPaymentIntent,
  isConfirmationTokenId,
  isPaymentIntentId,
  methodOf,
  paymentsReady,
  sameMode,
  toCents,
  type ConfirmationToken,
  type PaymentIntent,
  type PaymentMethodPreview,
  type PayMethod,
} from "@/lib/stripe";

/**
 * The pay page's three steps, all on the server: what the customer will pay with the details
 * they entered (the card fee is worked out here, never in the browser), the payment itself,
 * and the last word after their bank or card asked them to confirm.
 */

/** What a payment comes to, in cents, and how it is made. */
export interface Quote {
  method: PayMethod;
  /** "Visa credit card ending in 4242", in the page's language. */
  label: string;
  dueCents: number;
  feeCents: number;
  totalCents: number;
}

/**
 * Why a step could not go on:
 *   paid, processing, closed   the order changed (paid, a bank payment started, canceled): the page reloads
 *   expired                    the payment details must be entered again
 *   declined                   the card was declined
 *   changed                    the amount changed: the new quote comes with it
 *   generic                    anything else: nothing was charged
 */
export type Problem = "paid" | "processing" | "closed" | "expired" | "declined" | "changed" | "generic";

export type ReviewResult = { ok: true; quote: Quote } | { ok: false; reason: Problem };

export type PayResult =
  | { ok: true; status: "paid" | "processing" }
  | { ok: true; status: "action"; clientSecret: string; intentId: string }
  | { ok: false; reason: Problem; quote?: Quote };

interface Input {
  locale: string;
  token: string;
}

const BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  american_express: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
};

function describeMethod(locale: Locale, method: PayMethod, preview: PaymentMethodPreview | null): string {
  const card = preview?.card;
  const last4 = (method === "bank" ? preview?.us_bank_account?.last4 : card?.last4) ?? "";
  const code = card?.brand ?? "";
  const brand = BRANDS[code] ?? (code ? code.charAt(0).toUpperCase() + code.slice(1) : "");
  return fill(getDictionary(locale).pay.methods[method], { brand: isolate(brand, locale), last4: isolate(last4, locale) }).trim();
}

const asLocale = (value: string): Locale => (isLocale(value) ? value : "en");

type Prepared = { order: PayOrder; token: ConfirmationToken; quote: Quote } | { problem: Problem };

/** The order, the details entered and what they come to; or why the payment cannot go on. */
async function prepare(input: Input & { confirmationToken: string }): Promise<Prepared> {
  if (!paymentsReady() || !isPayToken(input.token) || !isConfirmationTokenId(input.confirmationToken)) return { problem: "generic" };
  const order = await getPayOrder(input.token);
  if (!order) return { problem: "closed" };
  const state = payState(order);
  if (state === "paid" || state === "processing") return { problem: state };
  if (state !== "open") return { problem: "closed" };

  let token: ConfirmationToken;
  try {
    token = await getConfirmationToken(input.confirmationToken);
  } catch (error) {
    if (error instanceof StripeError && error.status === 404) return { problem: "expired" };
    throw error;
  }
  // Used already, about to expire, or from the other mode: the customer enters their details again.
  const expiresSoon = token.expires_at != null && token.expires_at * 1000 < Date.now() + 60_000;
  if (token.payment_intent || expiresSoon || !sameMode(token.livemode)) return { problem: "expired" };
  const method = methodOf(token.payment_method_preview);
  if (!method) return { problem: "expired" };

  const dueCents = toCents(order.amountDue!);
  const feeCents = cardFeeCents(dueCents, token.payment_method_preview);
  return {
    order,
    token,
    quote: {
      method,
      label: describeMethod(asLocale(input.locale), method, token.payment_method_preview),
      dueCents,
      feeCents,
      totalCents: dueCents + feeCents,
    },
  };
}

/** Step 1: what paying with these details comes to. Nothing is charged. */
export async function reviewPayment(input: Input & { confirmationToken: string }): Promise<ReviewResult> {
  try {
    const p = await prepare(input);
    return "problem" in p ? { ok: false, reason: p.problem } : { ok: true, quote: p.quote };
  } catch (error) {
    console.error("[pay] review failed:", error);
    return { ok: false, reason: "generic" };
  }
}

/** What a payment's status means for the page, after recording it. */
async function settle(intent: PaymentIntent): Promise<PayResult> {
  if (intent.status === "requires_action" && intent.client_secret) {
    return { ok: true, status: "action", clientSecret: intent.client_secret, intentId: intent.id };
  }
  if (intent.status === "succeeded" || intent.status === "processing") {
    try {
      await recordPayment(intent);
    } catch (error) {
      // The money is in or on its way: the webhook records it, so the customer still hears it went through.
      console.error(`[pay] ${intent.id} went through but was not recorded yet:`, error);
    }
    return { ok: true, status: intent.status === "succeeded" ? "paid" : "processing" };
  }
  if (intent.status === "requires_payment_method") {
    return { ok: false, reason: intent.last_payment_error?.type === "card_error" ? "declined" : "generic" };
  }
  console.error(`[pay] ${intent.id} is ${intent.status}, which the pay page does not expect`);
  return { ok: false, reason: "generic" };
}

/**
 * Step 2: the payment. It goes through only for the amount the customer was shown
 * (`totalCents`); if the order or the fee changed since, they see the new amount first.
 */
export async function confirmPayment(input: Input & { confirmationToken: string; totalCents: number }): Promise<PayResult> {
  let prepared: Prepared;
  try {
    prepared = await prepare(input);
  } catch (error) {
    console.error("[pay] could not start the payment:", error);
    return { ok: false, reason: "generic" };
  }
  if ("problem" in prepared) return { ok: false, reason: prepared.problem };
  const { order, token, quote } = prepared;
  if (!Number.isSafeInteger(input.totalCents) || input.totalCents !== quote.totalCents) {
    return { ok: false, reason: "changed", quote };
  }

  let intent: PaymentIntent;
  try {
    intent = await createPayment({
      confirmationToken: token.id,
      amountCents: quote.totalCents,
      feeCents: quote.feeCents,
      description: `MOR Supply order ${order.number}`,
      returnUrl: `${siteOrigin()}${payPath(asLocale(input.locale), order.token)}`,
      receiptEmail: token.payment_method_preview?.billing_details?.email ?? null,
      metadata: {
        order_id: order.id,
        order_number: String(order.number),
        business: order.accountName.slice(0, 200),
        pay_token: order.token,
        method: quote.method,
        card_fee: String(quote.feeCents),
        amount_due: String(quote.dueCents),
      },
      // The same details always make the same payment: a second tap never charges twice.
      idempotencyKey: `mor-pay-${order.id}-${token.id}`,
    });
  } catch (error) {
    if (error instanceof StripeError && error.type === "card_error") return { ok: false, reason: "declined" };
    console.error(`[pay] order ${order.number}: Stripe refused the payment:`, error);
    return { ok: false, reason: "generic" };
  }
  return settle(intent);
}

/** Step 3, after the customer's bank or card asked them to confirm: where the payment stands now. */
export async function finishPayment(input: Input & { intentId: string }): Promise<PayResult> {
  if (!paymentsReady() || !isPayToken(input.token) || !isPaymentIntentId(input.intentId)) return { ok: false, reason: "generic" };
  try {
    const intent = await getPaymentIntent(input.intentId);
    // Only a payment made from this pay link.
    if (intent.metadata?.pay_token !== input.token || !sameMode(intent.livemode)) return { ok: false, reason: "generic" };
    return await settle(intent);
  } catch (error) {
    console.error("[pay] could not read the payment after confirming:", error);
    return { ok: false, reason: "generic" };
  }
}
