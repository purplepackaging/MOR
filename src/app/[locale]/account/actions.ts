"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { normalizeRepCode } from "@/config/reps";
import { REP_COOKIE } from "@/config/site";
import { getDictionary } from "@/i18n";
import { findVariant } from "@/lib/catalog";
import { isLocale, localePath, type Locale } from "@/lib/i18n";
import { sendNewAccountEmail, sendOrderEmail } from "@/lib/notify";
import { ACCOUNT_COOKIE, getPortal, portalReady, safeNext, setupPath, userClient } from "@/lib/portal";
import { validateSetup, valuesFromForm, type ErrorCode, type SetupKey } from "@/lib/request-validation";

/* ───────── Sign in with a password, or sign in and sign up with an email code ───────── */

export interface SignInState {
  step: "email" | "code";
  email: string;
  error?: "email" | "code" | "wait" | "generic" | "passwordLength";
  resent?: boolean;
}

export interface PasswordState {
  email: string;
  error?: "email" | "password" | "wait" | "generic";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Supabase stores a bcrypt hash, which reads no more than 72 bytes of a password. */
const PASSWORD_MIN = 8;
const PASSWORD_MAX_BYTES = 72;

function passwordFits(password: string): boolean {
  return password.length >= PASSWORD_MIN && new TextEncoder().encode(password).length <= PASSWORD_MAX_BYTES;
}

function readLocale(form: FormData): Locale {
  const raw = String(form.get("locale") ?? "");
  return isLocale(raw) ? raw : "en";
}

/**
 * Emails a one-time code. A new email gets a login too (open sign-up); they set
 * up their business after the first sign-in.
 */
export async function sendCode(prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  // Honeypot: people never see or fill this field, bots often do. Act as if a code went out.
  if (String(form.get("website") ?? "").trim()) return { step: "code", email };
  if (!EMAIL.test(email) || email.length > 160) return { step: "email", email, error: "email" };
  if (!portalReady()) return { step: prev.step, email, error: "generic" };

  const supabase = await userClient();
  let error;
  try {
    ({ error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }));
  } catch (thrown) {
    console.error("[portal] signInWithOtp threw:", thrown);
    return { step: prev.step, email, error: "generic" };
  }
  if (error) {
    if (error.status === 429 || error.code === "over_email_send_rate_limit") {
      return { step: prev.step, email, error: "wait" };
    }
    // Supabase is down, the project is paused, or sign-ups are switched off: say so
    // instead of promising a code that will never arrive.
    console.error("[portal] signInWithOtp failed:", error.status, error.code, error.message);
    return { step: prev.step, email, error: "generic" };
  }
  return { step: "code", email, resent: prev.step === "code" };
}

/** Where a person lands once they are signed in: the business form the first time, else where they were going. */
async function continueSignedIn(
  supabase: Awaited<ReturnType<typeof userClient>>,
  locale: Locale,
  next: string | null,
  fallback = localePath(locale, "/account"),
): Promise<never> {
  // First sign-in: no business yet, so set one up before anything else.
  const { data: links, error: linkError } = await supabase.from("account_users").select("account_id").limit(1);
  if (!linkError && !links?.length) {
    redirect(next?.startsWith(localePath(locale, "/account/setup")) ? next : setupPath(locale, next));
  }
  redirect(next ?? fallback);
}

/**
 * Signs in with an email and a password. A wrong email and a wrong password get
 * the same answer, so the form does not tell strangers who has an account.
 */
export async function passwordSignIn(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  const locale = readLocale(form);
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  // Honeypot: answer as if the password were wrong.
  if (String(form.get("website") ?? "").trim()) return { email, error: "password" };
  if (!EMAIL.test(email) || email.length > 160) return { email, error: "email" };
  if (!password || password.length > 200) return { email, error: "password" };
  if (!portalReady()) return { email, error: "generic" };

  const supabase = await userClient();
  let error;
  try {
    ({ error } = await supabase.auth.signInWithPassword({ email, password }));
  } catch (thrown) {
    console.error("[portal] signInWithPassword threw:", thrown);
    return { email, error: "generic" };
  }
  if (error) {
    if (error.status === 429) return { email, error: "wait" };
    // Down or paused: the password may be fine, so don't call it wrong.
    if (!error.status || error.status >= 500) {
      console.error("[portal] signInWithPassword failed:", error.status, error.code, error.message);
      return { email, error: "generic" };
    }
    return { email, error: "password" };
  }
  return continueSignedIn(supabase, locale, safeNext(String(form.get("next") ?? "")));
}

/**
 * Checks the emailed code and signs the person in. A password sent with it is saved
 * at the same moment: the code has just proved the email is theirs, so this one step
 * serves a new account, a forgotten password and a password change.
 */
export async function verifyCode(prev: SignInState, form: FormData): Promise<SignInState> {
  const locale = readLocale(form);
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const token = String(form.get("code") ?? "").replace(/\D/g, "");
  const password = String(form.get("password") ?? "");
  const mode = String(form.get("mode") ?? "");
  // New accounts and password changes need a password; a plain code sign-in may skip it.
  const needsPassword = mode === "create" || mode === "reset";
  if (!EMAIL.test(email)) return { step: "email", email, error: "email" };
  if (token.length < 6 || token.length > 10) return { step: "code", email, error: "code" };
  if (password ? !passwordFits(password) : needsPassword) return { step: "code", email, error: "passwordLength" };
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

  // Signed in from here on. A password that cannot be saved must not undo that:
  // the account page says so and offers another try.
  let saved: "saved" | "unsaved" | null = null;
  if (password) {
    saved = "saved";
    try {
      const { error: saveError } = await supabase.auth.updateUser({ password, data: { has_password: true } });
      // "same_password": they typed the password they already have, which is fine.
      if (saveError && saveError.code !== "same_password") {
        console.error("[portal] saving the password failed:", saveError.status, saveError.code, saveError.message);
        saved = "unsaved";
      }
    } catch (thrown) {
      console.error("[portal] saving the password threw:", thrown);
      saved = "unsaved";
    }
  }
  const next = safeNext(String(form.get("next") ?? ""));
  const account = localePath(locale, "/account");
  // Say what happened to the password on the account page, unless they are headed somewhere else.
  const told = saved === "unsaved" || (saved === "saved" && mode === "reset");
  return continueSignedIn(supabase, locale, next, told ? `${account}?password=${saved}` : account);
}

/* ───────── First sign-in: set up the business ───────── */

export interface SetupState {
  errors?: Partial<Record<SetupKey, ErrorCode>>;
  failed?: boolean;
}

export async function createAccount(_prev: SetupState, form: FormData): Promise<SetupState> {
  const locale = readLocale(form);
  const next = safeNext(String(form.get("next") ?? ""));
  const portal = await getPortal();
  if (!portal) redirect(`${localePath(locale, "/account/sign-in")}?next=${encodeURIComponent(setupPath(locale, next))}`);
  if (portal.account || portal.paused) redirect(localePath(locale, "/account"));
  if (String(form.get("website") ?? "").trim()) return { failed: true };

  const { errors, clean } = validateSetup(valuesFromForm(form));
  if (!clean) return { errors };

  // A rep code from the form, or else from the flyer QR code they scanned.
  const repCode = clean.repCode ?? (normalizeRepCode((await cookies()).get(REP_COOKIE)?.value) || null);
  const supabase = await userClient();
  const { data, error } = await supabase.rpc("create_my_account", {
    p_name: clean.businessName,
    p_contact_name: clean.contactName,
    p_phone: clean.phone,
    p_street: clean.street,
    p_city: clean.city,
    p_zip: clean.zip,
    p_language: clean.language,
    p_business_type: clean.businessType,
    p_rep_code: repCode,
    // Keep the exact wording the person agreed to, in the language they saw it.
    p_sms_consent_text: clean.smsConsent ? getDictionary(locale).request.sms : null,
  });
  if (error) {
    if (error.code === "23505") redirect(localePath(locale, "/account"));
    console.error("[portal] create_my_account failed:", error.code, error.message);
    return { failed: true };
  }

  (await cookies()).set(ACCOUNT_COOKIE, String(data), {
    path: "/",
    sameSite: "lax",
    secure: true,
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
  });
  await sendNewAccountEmail({ ...clean, repCode, email: portal.user.email ?? "" });
  redirect(next ?? localePath(locale, "/products"));
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
  | { ok: true; number: number; total: number | null }
  | { ok: false; reason: "signin" | "noAccount" | "empty" | "generic" };

export async function placeOrder(input: {
  locale: string;
  lines: unknown;
  note: unknown;
  nextDay: unknown;
}): Promise<PlaceOrderResult> {
  const portal = await getPortal();
  if (!portal) return { ok: false, reason: "signin" };
  if (!portal.account) return { ok: false, reason: "noAccount" };
  const lines = cleanLines(input.lines);
  if (lines.length === 0) return { ok: false, reason: "empty" };
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
  const locale: Locale = isLocale(input.locale) ? input.locale : "en";
  const nextDay = input.nextDay === true;

  // Prices and fees are set in the database, never here.
  const supabase = await userClient();
  const { data, error } = await supabase.rpc("place_order", {
    p_account: portal.account.id,
    p_lines: lines,
    p_note: note || null,
    p_locale: locale,
    p_next_day: nextDay,
  });
  const row = Array.isArray(data)
    ? (data[0] as { order_id: string; order_number: number | string; order_subtotal: number | string | null; order_total: number | string | null })
    : null;
  if (error || !row) {
    console.error("[portal] place_order failed:", error?.code, error?.message);
    return { ok: false, reason: "generic" };
  }
  const number = Number(row.order_number);
  const total = row.order_total == null ? null : Number(row.order_total);

  const { data: saved } = await supabase
    .from("orders")
    .select("delivery_fee, next_day_fee")
    .eq("id", row.order_id)
    .maybeSingle();
  await sendOrderEmail({
    number,
    accountName: portal.account.name,
    placedBy: portal.user.email ?? "",
    note,
    lines,
    subtotal: row.order_subtotal == null ? null : Number(row.order_subtotal),
    nextDay,
    deliveryFee: saved?.delivery_fee == null ? null : Number(saved.delivery_fee),
    nextDayFee: saved?.next_day_fee == null ? null : Number(saved.next_day_fee),
    total,
  });
  return { ok: true, number, total };
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
