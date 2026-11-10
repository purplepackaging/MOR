import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { site } from "@/config/site";
import { localePath, type Locale } from "@/lib/i18n";

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

/** Where a signed-in person without a business goes to set one up. */
export function setupPath(locale: Locale, next?: string | null): string {
  const base = localePath(locale, "/account/setup");
  return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}

export interface Fees {
  delivery: number;
  nextDay: number;
}

/** Delivery fees from Supabase (public.pricing), shown before a customer orders. */
export const getFees = cache(async (): Promise<Fees | null> => {
  const supabase = await userClient();
  const { data, error } = await supabase.rpc("order_fees");
  if (error) {
    console.error("[portal] order_fees failed:", error.message);
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : null) as { delivery_fee: number | string; next_day_fee: number | string } | null;
  return row ? { delivery: Number(row.delivery_fee), nextDay: Number(row.next_day_fee) } : null;
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
}

const ORDER_COLUMNS =
  "id, number, created_at, status, note, subtotal, next_day, delivery_fee, next_day_fee, total, order_lines(sku, cases, price_per_case)";

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
}

export async function getUsualOrder(accountId: string): Promise<UsualOrder | null> {
  const supabase = await userClient();
  const { data, error } = await supabase
    .from("usual_orders")
    .select("lines, updated_at")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error || !data) return null;
  const lines = Array.isArray(data.lines) ? (data.lines as { sku: string; cases: number }[]) : [];
  return lines.length ? { lines, updatedAt: data.updated_at as string } : null;
}

/** Only same-site paths, so a sign-in link cannot bounce people to another site. */
export function safeNext(value: string | string[] | undefined | null): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.includes("\\")) return null;
  return v.slice(0, 200);
}
