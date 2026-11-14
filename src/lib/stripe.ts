import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { site } from "@/config/site";

/**
 * Stripe, called over its HTTP API from the server: the secret key never reaches the
 * browser, and amounts are always worked out here. Payments are off until all three keys
 * are set in Vercel (STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET).
 * The live site refuses test keys, so nobody can think they paid when no money moved.
 */

/** The API version every call is made with, so answers keep their shape whatever the account's default. */
const API_VERSION = "2026-10-28.endive";
/**
 * Stripe's surcharge on credit cards is a public preview that needs this version. Only the call that
 * charges a credit card with its fee uses it: Stripe then sends the fee to the card network as a
 * surcharge and its receipts show it as a line of its own, as the card rules ask.
 */
const SURCHARGE_VERSION = "2026-03-25.preview";

export type StripeMode = "test" | "live";

interface Keys {
  secret: string;
  publishable: string;
  webhook: string;
  mode: StripeMode;
}

let warned = false;

function keys(): Keys | null {
  const secret = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const publishable = process.env.STRIPE_PUBLISHABLE_KEY?.trim() ?? "";
  const webhook = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret && !publishable && !webhook) return null;
  // A secret key (sk_) or a restricted key (rk_), and a publishable key from the same mode.
  const mode: StripeMode | null = /^(sk|rk)_live_/.test(secret) ? "live" : /^(sk|rk)_test_/.test(secret) ? "test" : null;
  let problem = "";
  if (!mode) problem = "STRIPE_SECRET_KEY is not a Stripe secret key";
  else if (!publishable.startsWith(`pk_${mode}_`)) problem = `STRIPE_PUBLISHABLE_KEY is not a ${mode} publishable key`;
  else if (!webhook.startsWith("whsec_")) problem = "STRIPE_WEBHOOK_SECRET is missing";
  else if (mode === "test" && process.env.VERCEL_ENV === "production") problem = "the live site does not take test payments";
  if (problem) {
    if (!warned) console.error(`[stripe] payments are off: ${problem}`);
    warned = true;
    return null;
  }
  return { secret, publishable, webhook, mode: mode! };
}

/** True when the site can take payments: Stripe keys in place and the database reachable with the server key. */
export function paymentsReady(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) && keys() !== null;
}

/** What the pay page's browser code needs: the publishable key (public by design) and the mode. */
export function publicStripe(): { publishableKey: string; mode: StripeMode } | null {
  const k = keys();
  return k ? { publishableKey: k.publishable, mode: k.mode } : null;
}

/* ───────── Amounts ───────── */

/** The credit card fee in basis points: 2.9% is 290. */
export const CARD_FEE_BPS = Math.round(site.cardSurchargePercent * 100);

/** Dollars as stored in the database to cents, without floating point drift ("156.66" -> 15666). */
export function toCents(amount: number | string): number {
  return Math.round(Number(amount) * 100);
}

/* ───────── Objects we read ───────── */

export type CardFunding = "credit" | "debit" | "prepaid" | "unknown";

export interface PaymentMethodPreview {
  type: string;
  card?: { brand?: string | null; funding?: CardFunding | null; country?: string | null; last4?: string | null } | null;
  us_bank_account?: { bank_name?: string | null; last4?: string | null } | null;
  billing_details?: { email?: string | null; name?: string | null } | null;
}

export interface ConfirmationToken {
  id: string;
  livemode: boolean;
  expires_at: number | null;
  payment_intent: string | null;
  payment_method_preview: PaymentMethodPreview | null;
}

export type PaymentIntentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "processing"
  | "requires_capture"
  | "canceled"
  | "succeeded";

export interface PaymentIntent {
  id: string;
  status: PaymentIntentStatus;
  amount: number;
  amount_received?: number;
  client_secret: string | null;
  livemode: boolean;
  metadata: Record<string, string>;
  last_payment_error?: { code?: string; decline_code?: string; message?: string; type?: string } | null;
}

export interface Dispute {
  id: string;
  amount: number;
  reason: string;
  payment_intent: string | null;
}

/** How an order was paid, as the orders table keeps it. */
export type PayMethod = "bank" | "credit_card" | "debit_card" | "card";

export function methodOf(preview: PaymentMethodPreview | null): PayMethod | null {
  if (preview?.type === "us_bank_account") return "bank";
  if (preview?.type !== "card") return null;
  const funding = preview.card?.funding;
  return funding === "credit" ? "credit_card" : funding === "debit" ? "debit_card" : "card";
}

/**
 * The fee a payment method adds to an order, in cents: the credit card fee on credit cards
 * issued in the US, where card rules let a business pass on what cards cost it (3% at most).
 * Bank payments, debit cards, prepaid cards and cards from other countries add nothing.
 */
export function cardFeeCents(dueCents: number, preview: PaymentMethodPreview | null): number {
  if (preview?.type !== "card" || preview.card?.funding !== "credit" || preview.card.country !== "US") return 0;
  return Math.round((dueCents * CARD_FEE_BPS) / 10_000);
}

/* ───────── Calls ───────── */

/** Stripe's form encoding: nested keys in brackets (a[b]=c) and lists by index (a[0]=d). */
export function formEncode(params: Record<string, unknown>): string {
  const out = new URLSearchParams();
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => add(`${key}[${i}]`, v));
    else if (typeof value === "object") for (const [k, v] of Object.entries(value)) add(`${key}[${k}]`, v);
    else out.append(key, String(value));
  };
  for (const [k, v] of Object.entries(params)) add(k, v);
  return out.toString();
}

/** An error Stripe answered with. `type` is "card_error" when the card was declined. */
export class StripeError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    readonly code: string | undefined,
    message: string,
    readonly paymentIntent: PaymentIntent | undefined,
  ) {
    super(message);
    this.name = "StripeError";
  }
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  options: { params?: Record<string, unknown>; idempotencyKey?: string; version?: string } = {},
): Promise<T> {
  const k = keys();
  if (!k) throw new Error("Stripe is not configured");
  // The tests point this at a stand-in. Everywhere else it is Stripe.
  const api = (process.env.STRIPE_API_URL ?? "https://api.stripe.com").replace(/\/+$/, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${k.secret}`,
    "Stripe-Version": options.version ?? API_VERSION,
  };
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  let url = `${api}${path}`;
  let body: string | undefined;
  if (method === "POST") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = formEncode(options.params ?? {});
  } else if (options.params) {
    url += `?${formEncode(options.params)}`;
  }
  const res = await fetch(url, { method, headers, body, cache: "no-store", signal: AbortSignal.timeout(25_000) });
  const data = (await res.json().catch(() => null)) as (T & { error?: undefined }) | { error?: Record<string, unknown> } | null;
  if (!res.ok || !data) {
    const e = (data?.error ?? {}) as { type?: string; code?: string; message?: string; payment_intent?: PaymentIntent };
    throw new StripeError(res.status, e.type ?? "api_error", e.code, e.message ?? `Stripe answered ${res.status}`, e.payment_intent);
  }
  return data as T;
}

const ID = { ctoken: /^ctoken_[A-Za-z0-9_]{1,200}$/, pi: /^pi_[A-Za-z0-9_]{1,200}$/ };
export const isConfirmationTokenId = (v: unknown): v is string => typeof v === "string" && ID.ctoken.test(v);
export const isPaymentIntentId = (v: unknown): v is string => typeof v === "string" && ID.pi.test(v);

/** The payment details the customer entered, as the Payment Element turned them into a ConfirmationToken. */
export function getConfirmationToken(id: string): Promise<ConfirmationToken> {
  return call<ConfirmationToken>("GET", `/v1/confirmation_tokens/${encodeURIComponent(id)}`);
}

export function getPaymentIntent(id: string): Promise<PaymentIntent> {
  return call<PaymentIntent>("GET", `/v1/payment_intents/${encodeURIComponent(id)}`);
}

/**
 * Creates and confirms one payment with the details in a ConfirmationToken. The same
 * token always gives the same payment (Stripe's idempotency key), so a second tap or a
 * retried request never charges twice. A credit card fee goes as Stripe's surcharge.
 */
export function createPayment(input: {
  confirmationToken: string;
  amountCents: number;
  feeCents: number;
  description: string;
  returnUrl: string;
  receiptEmail: string | null;
  metadata: Record<string, string>;
  idempotencyKey: string;
}): Promise<PaymentIntent> {
  const surcharge = input.feeCents > 0;
  return call<PaymentIntent>("POST", "/v1/payment_intents", {
    version: surcharge ? SURCHARGE_VERSION : undefined,
    idempotencyKey: input.idempotencyKey,
    params: {
      amount: input.amountCents,
      currency: "usd",
      confirm: true,
      confirmation_token: input.confirmationToken,
      return_url: input.returnUrl,
      // As on the pay page: bank accounts are linked through the bank's sign-in, never typed in.
      payment_method_options: { us_bank_account: { verification_method: "instant" } },
      description: input.description,
      metadata: input.metadata,
      receipt_email: input.receiptEmail ?? undefined,
      // Stripe charges only `amount`, which already holds the fee; the surcharge says how much of it is the fee.
      amount_details: surcharge ? { surcharge: { amount: input.feeCents, enforce_validation: "enabled" } } : undefined,
    },
  });
}

/* ───────── Webhooks ───────── */

/** Events older than this are refused, so a captured request cannot be replayed later. */
const TOLERANCE_SECONDS = 300;

/**
 * Checks the Stripe-Signature header of a webhook against the endpoint's signing secret:
 * an HMAC-SHA256 of "<timestamp>.<raw body>", compared in constant time.
 */
export function verifyWebhook(payload: string, header: string | null, now = Date.now()): boolean {
  const k = keys();
  if (!k || !header) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [name, value] = part.split("=", 2).map((s) => s?.trim() ?? "");
    if (name === "t") timestamp = value;
    else if (name === "v1" && value) signatures.push(value);
  }
  const t = Number(timestamp);
  if (!/^\d+$/.test(timestamp) || !signatures.length || Math.abs(now / 1000 - t) > TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", k.webhook).update(`${timestamp}.${payload}`, "utf8").digest();
  return signatures.some((sig) => {
    if (!/^[0-9a-f]{64}$/.test(sig)) return false;
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** True when an object from Stripe belongs to the mode the site runs in (a test event never touches live orders). */
export function sameMode(livemode: unknown): boolean {
  const k = keys();
  return Boolean(k) && livemode === (k!.mode === "live");
}
