import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { site } from "@/config/site";
import type { DeliveryTerms } from "@/lib/delivery";
import { isLocale, localePath, type Locale } from "@/lib/i18n";
import type { Payment } from "@/lib/payments";
import { SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * Customer portal data access. Everything runs on the server with the signed-in
 * user's session, so row level security in Postgres decides what each customer
 * can read. The publishable key is safe on its own; it is kept server-side anyway.
 */

/** Cookie that remembers which business a multi-account user is ordering for. */
export const ACCOUNT_COOKIE = "mor_account";

export function portalReady(): boolean {
  return site.portalEnabled && Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);
}

export async function userClient() {
  const jar = await cookies();
  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    cookieOptions: SESSION_COOKIE,
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) jar.set(name, value, options);
        } catch {
          /* Server Components cannot set cookies. The proxy refreshes sessions for portal pages. */
        }
      },
    },
  });
}

export type DeliveryDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export interface PortalAccount {
  id: string;
  name: string;
  deliveryDay: DeliveryDay | null;
}

export interface Portal {
  user: User;
  account: PortalAccount | null;
  accounts: PortalAccount[];
  /** Signed in, on an account, but every account they belong to is switched off. */
  paused: boolean;
}

/** The signed-in user and the business they are ordering for, once per request. */
export const getPortal = cache(async (): Promise<Portal | null> => {
  if (!portalReady()) return null;
  const supabase = await userClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: rows } = await supabase
    .from("accounts")
    .select("id, name, delivery_day, created_at")
    .order("created_at", { ascending: true });
  const accounts: PortalAccount[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    deliveryDay: (r.delivery_day as DeliveryDay | null) ?? null,
  }));
  const chosen = (await cookies()).get(ACCOUNT_COOKIE)?.value;
  const account = accounts.find((a) => a.id === chosen) ?? accounts[0] ?? null;
  // Accounts you switch off disappear from the list above, but the membership stays.
  let paused = false;
  if (!account) {
    const { data: links } = await supabase.from("account_users").select("account_id").limit(1);
    paused = Boolean(links?.length);
  }
  return { user: data.user, account, accounts, paused };
});

export interface AccountDetails {
  name: string;
  contactName: string;
  /** E.164, as stored. */
  phone: string;
  street: string;
  city: string;
  zip: string;
  language: Locale;
}

/** The details of a business, for the people who order for it. Null if they cannot be read. */
export async function getAccountDetails(accountId: string): Promise<AccountDetails | null> {
  const supabase = await userClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("name, contact_name, phone, street, city, zip, preferred_language")
    .eq("id", accountId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("[portal] account details failed:", error.message);
    return null;
  }
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const language = text(data.preferred_language);
  return {
    name: text(data.name),
    contactName: text(data.contact_name),
    phone: text(data.phone),
    street: text(data.street),
    city: text(data.city),
    zip: text(data.zip),
    language: isLocale(language) ? language : "en",
  };
}

/** Owners change the details of a business. Staff added as buyers only order for it. */
export async function isOwner(accountId: string, userId: string): Promise<boolean> {
  const supabase = await userClient();
  const { data, error } = await supabase
    .from("account_users")
    .select("role")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  return !error && data?.role === "owner";
}

/** Where a signed-in person without a business goes to set one up. */
export function setupPath(locale: Locale, next?: string | null): string {
  const base = localePath(locale, "/account/setup");
  return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}

/**
 * What delivery costs, from Supabase (public.pricing): the fee and the subtotal from which it is free.
 * Shown before a customer orders; `place_order` decides what the order is charged.
 */
export const getFees = cache(async (): Promise<DeliveryTerms | null> => {
  const supabase = await userClient();
  const { data, error } = await supabase.rpc("delivery_terms");
  if (error) {
    console.error("[portal] delivery_terms failed:", error.message);
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : null) as
    | { delivery_fee: number | string; free_delivery_from: number | string | null }
    | null;
  return row
    ? { delivery: Number(row.delivery_fee), freeFrom: row.free_delivery_from == null ? null : Number(row.free_delivery_from) }
    : null;
});

/** Price per case by SKU, or null while no product has a cost yet. */
export const getPrices = cache(async (accountId: string): Promise<Record<string, number> | null> => {
  const supabase = await userClient();
  const { data, error } = await supabase.rpc("my_prices", { p_account: accountId });
  if (error) {
    console.error("[portal] my_prices failed:", error.message);
    return null;
  }
  const rows = (data ?? []) as { sku: string; price_per_case: number | string }[];
  if (rows.length === 0) return null;
  return Object.fromEntries(rows.map((r) => [r.sku, Number(r.price_per_case)]));
});

export interface OrderLine {
  sku: string;
  cases: number;
  price: number | null;
}

export interface OrderSummary {
  id: string;
  number: number;
  createdAt: string;
  status: "received" | "confirmed" | "out_for_delivery" | "delivered" | "canceled";
  note: string | null;
  subtotal: number | null;
  nextDay: boolean;
  /** Null on orders placed before delivery fees existed. */
  deliveryFee: number | null;
  nextDayFee: number | null;
  /** Subtotal plus fees. Null while any line has no price. */
  total: number | null;
  lines: OrderLine[];
  /** The end of the order's pay link (/pay/<token>). */
  payToken: string;
  payment: Payment;
}

const ORDER_COLUMNS =
  "id, number, created_at, status, note, subtotal, next_day, delivery_fee, next_day_fee, total, order_lines(sku, cases, price_per_case), pay_token, payment_status, payment_method, card_fee, payment_amount, paid_at, payment_updated_at";

const money = (v: unknown) => (v == null ? null : Number(v));

function toOrder(r: Record<string, unknown>): OrderSummary {
  const lines = (r.order_lines as { sku: string; cases: number; price_per_case: number | string | null }[] | null) ?? [];
  return {
    id: r.id as string,
    number: Number(r.number),
    createdAt: r.created_at as string,
    status: r.status as OrderSummary["status"],
    note: (r.note as string | null) ?? null,
    subtotal: money(r.subtotal),
    nextDay: r.next_day === true,
    deliveryFee: money(r.delivery_fee),
    nextDayFee: money(r.next_day_fee),
    total: money(r.total),
    lines: lines.map((l) => ({ sku: l.sku, cases: l.cases, price: money(l.price_per_case) })),
    payToken: String(r.pay_token),
    payment: {
      status: (r.payment_status as Payment["status"]) ?? "unpaid",
      method: (r.payment_method as Payment["method"]) ?? null,
      cardFee: money(r.card_fee),
      amount: money(r.payment_amount),
      paidAt: (r.paid_at as string | null) ?? null,
      updatedAt: (r.payment_updated_at as string | null) ?? null,
    },
  };
}

/** What the order costs in all, for lists: the total, or the subtotal on orders from before fees. */
export function orderAmount(o: OrderSummary): number | null {
  return o.deliveryFee == null ? o.subtotal : o.total;
}

export async function getOrders(accountId: string, limit = 50): Promise<OrderSummary[]> {
  const supabase = await userClient();
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[portal] orders failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => toOrder(r as Record<string, unknown>));
}

export async function getOrder(accountId: string, number: number): Promise<OrderSummary | null> {
  const supabase = await userClient();
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("account_id", accountId)
    .eq("number", number)
    .maybeSingle();
  if (error || !data) return null;
  return toOrder(data as Record<string, unknown>);
}

export interface UsualOrder {
  lines: { sku: string; cases: number }[];
  updatedAt: string;
  /** The customer asked for this order every week. */
  weekly: boolean;
  /** One delivery date ("2026-11-19") they want left out. */
  skipDate: string | null;
}

export async function getUsualOrder(accountId: string): Promise<UsualOrder | null> {
  const supabase = await userClient();
  const { data, error } = await supabase
    .from("usual_orders")
    .select("lines, updated_at, weekly, skip_date")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error || !data) return null;
  const lines = Array.isArray(data.lines) ? (data.lines as { sku: string; cases: number }[]) : [];
  return lines.length
    ? {
        lines,
        updatedAt: data.updated_at as string,
        weekly: data.weekly === true,
        skipDate: typeof data.skip_date === "string" ? data.skip_date : null,
      }
    : null;
}

/**
 * Where a customer's weekly order stands.
 *   off        they have not asked for one
 *   asked      they asked; it is not running yet (no delivery day, or weekly orders are not switched on)
 *   on         it runs: `next` is the coming delivery and when its order closes
 */
export type WeeklyState =
  /** `ready`: asking would start it right away (a delivery day is set and weekly orders are switched on). */
  | { status: "off"; ready: boolean }
  | { status: "asked" }
  | {
      status: "on";
      next: { date: string; closesAt: string };
      /** The coming delivery is being skipped; `after` is the one that follows. */
      skipped: boolean;
      after: string;
    };

const plusDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The dates come from the database (public.next_delivery), which also places the orders. */
export async function getWeekly(account: PortalAccount, usual: UsualOrder | null): Promise<WeeklyState> {
  const asked = usual?.weekly === true;
  if (!usual || !account.deliveryDay) return asked ? { status: "asked" } : { status: "off", ready: false };
  const supabase = await userClient();
  const [live, next] = await Promise.all([
    supabase.rpc("weekly_orders_live"),
    supabase.rpc("next_delivery", { p_day: account.deliveryDay }),
  ]);
  const row = (Array.isArray(next.data) ? next.data[0] : null) as { delivery_date: string; closes_at: string } | null;
  if (live.error || next.error) {
    console.error("[portal] weekly order state failed:", live.error?.message ?? next.error?.message);
  }
  const running = !live.error && !next.error && live.data === true && row !== null;
  if (!asked) return { status: "off", ready: running };
  if (!running || !row) return { status: "asked" };
  return {
    status: "on",
    next: { date: row.delivery_date, closesAt: row.closes_at },
    skipped: usual.skipDate === row.delivery_date,
    after: plusDays(row.delivery_date, 7),
  };
}

/**
 * A path on this site: one leading slash, then only the characters a URL path
 * and query can hold. Browsers drop tabs and line breaks from URLs and read "\"
 * as "/", so "/<tab>/example.com" would otherwise become "//example.com".
 */
const SAME_SITE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/;

/** Only same-site paths, so a sign-in link cannot bounce people to another site. */
export function safeNext(value: string | string[] | undefined | null): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || v.length > 200 || !SAME_SITE_PATH.test(v)) return null;
  return v;
}
