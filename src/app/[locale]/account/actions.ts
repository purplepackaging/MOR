"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findVariant } from "@/lib/catalog";
import { isLocale, localePath, type Locale } from "@/lib/i18n";
import { sendOrderEmail } from "@/lib/notify";
import { ACCOUNT_COOKIE, getPortal, portalReady, safeNext, userClient } from "@/lib/portal";

/* ───────── Sign in with an email code ───────── */

export interface SignInState {
  step: "email" | "code";
  email: string;
  error?: "email" | "code" | "wait" | "generic";
  resent?: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function readLocale(form: FormData): Locale {
  const raw = String(form.get("locale") ?? "");
  return isLocale(raw) ? raw : "en";
}

/**
 * Emails a one-time code. Only people you added in Supabase can sign in
 * (shouldCreateUser: false), and the answer is the same whether or not the
 * email has an account, so the form never reveals who your customers are.
 */
export async function sendCode(prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 160) return { step: "email", email, error: "email" };
  if (!portalReady()) return { step: prev.step, email, error: "generic" };

  const supabase = await userClient();
  let error;
  try {
    ({ error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }));
  } catch (thrown) {
    console.error("[portal] signInWithOtp threw:", thrown);
    return { step: prev.step, email, error: "generic" };
  }
  if (error) {
    if (error.status === 429 || error.code === "over_email_send_rate_limit") {
      return { step: prev.step, email, error: "wait" };
    }
    // Supabase is down or the project is paused: say so instead of promising a code.
    // These failures happen for every email alike, so they reveal nothing about who has an account.
    if (!error.status || error.status >= 500) {
      console.error("[portal] signInWithOtp failed:", error.status, error.code, error.message);
      return { step: prev.step, email, error: "generic" };
    }
    // Unknown emails land here too (signups are off). Answer as if it worked.
    if (error.code !== "otp_disabled" && error.code !== "signup_disabled" && error.code !== "user_not_found") {
      console.error("[portal] signInWithOtp failed:", error.code, error.message);
    }
  }
  return { step: "code", email, resent: prev.step === "code" };
}

export async function verifyCode(prev: SignInState, form: FormData): Promise<SignInState> {
  const locale = readLocale(form);
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const token = String(form.get("code") ?? "").replace(/\D/g, "");
  if (!EMAIL.test(email)) return { step: "email", email, error: "email" };
  if (token.length < 6 || token.length > 10) return { step: "code", email, error: "code" };
  if (!portalReady()) return { step: "code", email, error: "generic" };

  const supabase = await userClient();
  let error;
  try {
    ({ error } = await supabase.auth.verifyOtp({ email, token, type: "email" }));
  } catch (thrown) {
    console.error("[portal] verifyOtp threw:", thrown);
    return { step: "code", email, error: "generic" };
  }
  if (error) {
    if (error.status === 429) return { step: "code", email, error: "wait" };
    // Down or paused: the code may be fine, so don't call it wrong.
    if (!error.status || error.status >= 500) {
      console.error("[portal] verifyOtp failed:", error.status, error.code, error.message);
      return { step: "code", email, error: "generic" };
    }
    return { step: "code", email, error: "code" };
  }
  redirect(safeNext(String(form.get("next") ?? "")) ?? localePath(locale, "/account"));
}

export async function signOut(form: FormData): Promise<void> {
  const locale = readLocale(form);
  if (portalReady()) {
    const supabase = await userClient();
    await supabase.auth.signOut();
  }
  (await cookies()).delete(ACCOUNT_COOKIE);
  redirect(localePath(locale, "/"));
}

/** For people who order for more than one business. */
export async function switchAccount(form: FormData): Promise<void> {
  const locale = readLocale(form);
  const id = String(form.get("account") ?? "");
  const portal = await getPortal();
  if (portal?.accounts.some((a) => a.id === id)) {
    (await cookies()).set(ACCOUNT_COOKIE, id, { path: "/", sameSite: "lax", secure: true, httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
  }
  redirect(localePath(locale, "/account"));
}

/* ───────── Orders and the usual order ───────── */

export interface ListInput {
  lines: { sku: string; cases: number }[];
}

/** Keeps only SKUs the catalog sells, whole cases from 1 to 999, first line per SKU. */
function cleanLines(input: unknown): { sku: string; cases: number }[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: { sku: string; cases: number }[] = [];
  for (const raw of input.slice(0, 150)) {
    if (!raw || typeof raw !== "object") continue;
    const { sku, cases } = raw as { sku?: unknown; cases?: unknown };
    if (typeof sku !== "string" || seen.has(sku) || !findVariant(sku)) continue;
    if (typeof cases !== "number" || !Number.isInteger(cases) || cases < 1 || cases > 999) continue;
    seen.add(sku);
    out.push({ sku, cases });
  }
  return out;
}

export type PlaceOrderResult =
  | { ok: true; number: number; subtotal: number | null }
  | { ok: false; reason: "signin" | "noAccount" | "empty" | "generic" };

export async function placeOrder(input: { locale: string; lines: unknown; note: unknown }): Promise<PlaceOrderResult> {
  const portal = await getPortal();
  if (!portal) return { ok: false, reason: "signin" };
  if (!portal.account) return { ok: false, reason: "noAccount" };
  const lines = cleanLines(input.lines);
  if (lines.length === 0) return { ok: false, reason: "empty" };
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
  const locale: Locale = isLocale(input.locale) ? input.locale : "en";

  const supabase = await userClient();
  const { data, error } = await supabase.rpc("place_order", {
    p_account: portal.account.id,
    p_lines: lines,
    p_note: note || null,
    p_locale: locale,
  });
  const row = Array.isArray(data) ? (data[0] as { order_number: number | string; order_subtotal: number | string | null }) : null;
  if (error || !row) {
    console.error("[portal] place_order failed:", error?.code, error?.message);
    return { ok: false, reason: "generic" };
  }
  const number = Number(row.order_number);
  const subtotal = row.order_subtotal == null ? null : Number(row.order_subtotal);

  await sendOrderEmail({
    number,
    accountName: portal.account.name,
    placedBy: portal.user.email ?? "",
    note,
    lines,
    subtotal,
  });
  return { ok: true, number, subtotal };
}

export type SaveUsualResult = { ok: true; count: number } | { ok: false; reason: "signin" | "noAccount" | "generic" };

export async function saveUsualOrder(input: ListInput): Promise<SaveUsualResult> {
  const portal = await getPortal();
  if (!portal) return { ok: false, reason: "signin" };
  if (!portal.account) return { ok: false, reason: "noAccount" };
  const supabase = await userClient();
  const { data, error } = await supabase.rpc("save_usual_order", {
    p_account: portal.account.id,
    p_lines: cleanLines(input.lines),
  });
  if (error) {
    console.error("[portal] save_usual_order failed:", error.code, error.message);
    return { ok: false, reason: "generic" };
  }
  return { ok: true, count: Number(data ?? 0) };
}
