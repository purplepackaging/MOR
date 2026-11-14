import "server-only";
import { site } from "@/config/site";
import { isLocale, localePath, type Locale } from "@/lib/i18n";
import { sendPaymentEmail } from "./notify";
import { type PaymentIntent, type PayMethod, toCents } from "./stripe";
import { serverRest } from "./supabase";

/**
 * Paying for an order from its pay link. The database decides what an order comes to and
 * keeps where its payment stands (public.order_for_pay, public.set_order_payment); both
 * answer only to the server key.
 */

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A pay link's token: a UUID, written in lower case as the database writes it. */
export function isPayToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

export type PaymentStatus = "unpaid" | "processing" | "paid" | "failed";
export type OrderStatus = "received" | "confirmed" | "out_for_delivery" | "delivered" | "canceled";

export interface Payment {
  status: PaymentStatus;
  method: PayMethod | null;
  /** The credit card fee on top of the order, in dollars. */
  cardFee: number | null;
  /** What the payment comes to: the order plus any card fee. */
  amount: number | null;
  paidAt: string | null;
  updatedAt: string | null;
}

export interface PayOrder {
  id: string;
  token: string;
  number: number;
  accountName: string;
  createdAt: string;
  status: OrderStatus;
  subtotal: number | null;
  deliveryFee: number | null;
  nextDay: boolean;
  nextDayFee: number | null;
  /** What the order comes to, or null while a price is still to be confirmed. */
  amountDue: number | null;
  /** The language the order was placed in. */
  locale: Locale;
  lines: { sku: string; cases: number; price: number | null }[];
  payment: Payment;
}

const money = (v: unknown) => (v == null ? null : Number(v));

/** The order behind a pay link, or null for a link that leads nowhere. Throws when Supabase cannot be reached. */
export async function getPayOrder(token: string): Promise<PayOrder | null> {
  if (!isPayToken(token)) return null;
  const { base, headers } = serverRest();
  const res = await fetch(`${base}/rpc/order_for_pay`, {
    method: "POST",
    headers,
    body: JSON.stringify({ p_token: token }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`order_for_pay answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const rows: unknown = await res.json();
  const r = (Array.isArray(rows) ? rows[0] : null) as Record<string, unknown> | null | undefined;
  if (!r) return null;
  const lines = Array.isArray(r.lines) ? (r.lines as { sku: string; cases: number; price: number | string | null }[]) : [];
  const locale = String(r.site_locale);
  return {
    id: String(r.order_id),
    token,
    number: Number(r.order_number),
    accountName: String(r.account_name),
    createdAt: String(r.created_at),
    status: r.status as OrderStatus,
    subtotal: money(r.subtotal),
    deliveryFee: money(r.delivery_fee),
    nextDay: r.next_day === true,
    nextDayFee: money(r.next_day_fee),
    amountDue: money(r.amount_due),
    locale: isLocale(locale) ? locale : "en",
    lines: lines.map((l) => ({ sku: l.sku, cases: Number(l.cases), price: money(l.price) })),
    payment: {
      status: r.payment_status as PaymentStatus,
      method: (r.payment_method as PayMethod | null) ?? null,
      cardFee: money(r.card_fee),
      amount: money(r.payment_amount),
      paidAt: (r.paid_at as string | null) ?? null,
      updatedAt: (r.payment_updated_at as string | null) ?? null,
    },
  };
}

/** Stripe takes nothing under 50 cents. */
const MIN_CENTS = 50;

/**
 * Where an order stands for paying online:
 *   open        it can be paid (never paid, or the last payment failed)
 *   paid        the money is in
 *   processing  a bank payment is on its way
 *   canceled    nothing to pay
 *   noTotal     a price is still to be confirmed, so there is no amount yet
 */
export type PayState = "open" | "paid" | "processing" | "canceled" | "noTotal";

export function payState(order: PayOrder): PayState {
  if (order.payment.status === "paid") return "paid";
  if (order.payment.status === "processing") return "processing";
  if (order.status === "canceled") return "canceled";
  if (order.amountDue == null || toCents(order.amountDue) < MIN_CENTS) return "noTotal";
  return "open";
}

/**
 * Where links in the team's emails point. Preview deployments link to themselves, so a test
 * order's link opens the preview it was placed on, never the live site.
 */
export function siteOrigin(): string {
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return site.url.replace(/\/+$/, "");
}

export function payPath(locale: Locale, token: string): string {
  return localePath(locale, `/pay/${token}`);
}

export function payUrl(locale: Locale, token: string): string {
  return `${siteOrigin()}${payPath(locale, token)}`;
}

/** What each Stripe payment status means for the order. The others (needs the customer, or Stripe) change nothing. */
const RECORDED: Partial<Record<PaymentIntent["status"], "paid" | "processing" | "failed">> = {
  succeeded: "paid",
  processing: "processing",
  requires_payment_method: "failed",
  canceled: "failed",
};

const METHODS: readonly PayMethod[] = ["bank", "credit_card", "debit_card", "card"];

/**
 * Records where a payment stands, from the pay page right after paying and from Stripe's
 * webhook (which may repeat itself, or arrive late). The team hears when something changed,
 * and when an order looks paid twice. Throws when Supabase cannot be reached, so Stripe
 * sends the event again.
 */
export async function recordPayment(intent: PaymentIntent): Promise<"paid" | "processing" | "failed" | null> {
  const orderId = intent.metadata?.order_id;
  const status = RECORDED[intent.status];
  if (!orderId || !status) return null;
  const method = METHODS.find((m) => m === intent.metadata.method) ?? "card";
  const feeCents = Math.max(0, Math.round(Number(intent.metadata.card_fee) || 0));
  const amountCents = status === "paid" ? intent.amount_received || intent.amount : intent.amount;

  const { base, headers } = serverRest();
  const res = await fetch(`${base}/rpc/set_order_payment`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      p_order: orderId,
      p_status: status,
      p_intent: intent.id,
      p_method: status === "failed" ? null : method,
      p_card_fee: feeCents / 100,
      p_amount: status === "failed" ? null : amountCents / 100,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`set_order_payment answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const rows: unknown = await res.json();
  const row = (Array.isArray(rows) ? rows[0] : null) as
    | { result: string; order_number: number | string; account_name: string; pay_token: string; site_locale: string; order_status: string }
    | null
    | undefined;
  if (!row) {
    console.error(`[payments] ${intent.id} names an order that is not in the database (${orderId})`);
    return null;
  }
  if (row.result === "changed" || row.result === "twice") {
    await sendPaymentEmail({
      kind: row.result === "twice" ? "twice" : status,
      number: Number(row.order_number),
      accountName: row.account_name,
      method,
      amount: amountCents / 100,
      cardFee: feeCents / 100,
      intentId: intent.id,
      reason: intent.last_payment_error?.message ?? null,
      orderCanceled: row.order_status === "canceled",
      payUrl: payUrl(isLocale(row.site_locale) ? row.site_locale : "en", row.pay_token),
    });
  }
  return status;
}
