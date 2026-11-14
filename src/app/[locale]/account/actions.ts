"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { normalizeRepCode } from "@/config/reps";
import { REP_COOKIE } from "@/config/site";
import { getDictionary } from "@/i18n";
import { findVariant } from "@/lib/catalog";
import { isLocale, localePath, type Locale } from "@/lib/i18n";
import {
  sendDetailsChangedEmail,
  sendNewAccountEmail,
  sendOrderCanceledEmail,
  sendOrderEmail,
  sendWeeklyChangedEmail,
} from "@/lib/notify";
import {
  ACCOUNT_COOKIE,
  getAccountDetails,
  getOrder,
  getPortal,
  portalReady,
  safeNext,
  setupPath,
  userClient,
} from "@/lib/portal";
import { payUrl } from "@/lib/payments";
import { getShelfNow } from "@/lib/shelf";
import { paymentsReady } from "@/lib/stripe";
import {
  formatUsPhone,
  validateSetup,
  valuesFromForm,
  type ErrorCode,
  type RequestValues,
  type SetupKey,
} from "@/lib/request-validation";

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

/** What the person typed, sent back with a problem so the form keeps it. */
export interface SetupValues {
  businessName: string;
  businessType: string;
  street: string;
  city: string;
  zip: string;
  contactName: string;
  phone: string;
  language: string;
  repCode: string;
  smsConsent: boolean;
}

export interface SetupState {
  errors?: Partial<Record<SetupKey, ErrorCode>>;
  failed?: boolean;
  values?: SetupValues;
}

function setupValues(v: RequestValues): SetupValues {
  const cut = (s: string) => s.slice(0, 200);
  return {
    businessName: cut(v.businessName),
    businessType: cut(v.businessType),
    street: cut(v.street),
    city: cut(v.city),
    zip: cut(v.zip),
    contactName: cut(v.contactName),
    phone: cut(v.phone),
    language: cut(v.language),
    repCode: cut(v.repCode),
    smsConsent: v.smsConsent,
  };
}

export async function createAccount(_prev: SetupState, form: FormData): Promise<SetupState> {
  const locale = readLocale(form);
  const next = safeNext(String(form.get("next") ?? ""));
  const portal = await getPortal();
  if (!portal) redirect(`${localePath(locale, "/account/sign-in")}?next=${encodeURIComponent(setupPath(locale, next))}`);
  if (portal.account || portal.paused) redirect(localePath(locale, "/account"));
  if (String(form.get("website") ?? "").trim()) return { failed: true };

  const typed = valuesFromForm(form);
  const values = setupValues(typed);
  const { errors, clean } = validateSetup(typed);
  if (!clean) return { errors, values };

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
    return { failed: true, values };
  }

  (await cookies()).set(ACCOUNT_COOKIE, String(data), {
    path: "/",
    sameSite: "lax",
    secure: true,
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
  });
  await sendNewAccountEmail({ ...clean, repCode, email: portal.user.email ?? "" });
  // Straight to the products, with a line that says the account is ready.
  redirect(next ?? `${localePath(locale, "/products")}?welcome=1`);
}

/* ───────── Self-service: business details, canceling an order ───────── */

export interface DetailsState {
  errors?: Partial<Record<SetupKey, ErrorCode>>;
  failed?: boolean;
  values?: SetupValues;
}

/** The owner corrects the business details. The team hears what changed. */
export async function updateDetails(_prev: DetailsState, form: FormData): Promise<DetailsState> {
  const locale = readLocale(form);
  const account = localePath(locale, "/account");
  const portal = await getPortal();
  if (!portal) {
    redirect(`${localePath(locale, "/account/sign-in")}?next=${encodeURIComponent(localePath(locale, "/account/details"))}`);
  }
  if (!portal.account) redirect(account);

  const typed = valuesFromForm(form);
  const values = setupValues(typed);
  const { errors, clean } = validateSetup(typed);
  if (!clean) return { errors, values };

  const before = await getAccountDetails(portal.account.id);
  const supabase = await userClient();
  const { error } = await supabase.rpc("update_my_account", {
    p_account: portal.account.id,
    p_name: clean.businessName,
    p_contact_name: clean.contactName,
    p_phone: clean.phone,
    p_street: clean.street,
    p_city: clean.city,
    p_zip: clean.zip,
    p_language: clean.language,
  });
  if (error) {
    console.error("[portal] update_my_account failed:", error.code, error.message);
    return { failed: true, values };
  }

  if (before) {
    const rows: [string, string, string][] = [
      ["Business", before.name, clean.businessName],
      ["Contact", before.contactName, clean.contactName],
      ["Phone", before.phone, clean.phone],
      ["Street", before.street, clean.street],
      ["City", before.city, clean.city],
      ["ZIP", before.zip, clean.zip],
      ["Language", before.language, clean.language],
    ];
    await sendDetailsChangedEmail({
      accountName: before.name,
      changedBy: portal.user.email ?? "",
      changes: rows
        .filter(([, was, now]) => was !== now)
        .map(([label, was, now]) =>
          label === "Phone"
            ? { label, before: was ? formatUsPhone(was) : "", after: formatUsPhone(now) }
            : { label, before: was, after: now },
        ),
    });
  }
  redirect(`${account}?details=saved`);
}

export interface CancelState {
  failed?: boolean;
}

/**
 * Cancels an order that is still "received". The database decides: once the team
 * has confirmed it, the order stays as it is and the page says so.
 */
export async function cancelOrder(_prev: CancelState, form: FormData): Promise<CancelState> {
  const locale = readLocale(form);
  const number = Number(form.get("number"));
  if (!Number.isSafeInteger(number) || number <= 0) return { failed: true };
  const orderPath = localePath(locale, `/account/orders/${number}`);
  const portal = await getPortal();
  if (!portal) redirect(`${localePath(locale, "/account/sign-in")}?next=${encodeURIComponent(orderPath)}`);
  if (!portal.account) redirect(localePath(locale, "/account"));

  // Already canceled (a second tap, or another tab): nothing to do, and no second email.
  const order = await getOrder(portal.account.id, number);
  if (!order) return { failed: true };
  if (order.status === "canceled") redirect(`${orderPath}?canceled=1`);

  const supabase = await userClient();
  const { data, error } = await supabase.rpc("cancel_my_order", { p_account: portal.account.id, p_number: number });
  if (error) {
    console.error("[portal] cancel_my_order failed:", error.code, error.message);
    return { failed: true };
  }
  if (data === "too_late") redirect(`${orderPath}?late=1`);
  // Paid, or a bank payment is on its way: that takes a refund, which the team makes.
  if (data === "paid") redirect(`${orderPath}?paid=1`);
  if (data !== "canceled") return { failed: true };
  await sendOrderCanceledEmail({ number, accountName: portal.account.name, canceledBy: portal.user.email ?? "" });
  redirect(`${orderPath}?canceled=1`);
}

/* ───────── The weekly order ───────── */

const DAY_NAMES = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" };

/** The account page with a line that says what happened to the weekly order. */
function weeklyNote(locale: Locale, note: "asked" | "off" | "skipped" | "unskipped" | "failed"): never {
  redirect(`${localePath(locale, "/account")}?weekly=${note}`);
}

/** Asks for the usual order every week, or turns that off. The team hears either way. */
export async function setWeekly(form: FormData): Promise<void> {
  const locale = readLocale(form);
  const on = form.get("on") === "1";
  const portal = await getPortal();
  if (!portal) redirect(`${localePath(locale, "/account/sign-in")}?next=${encodeURIComponent(localePath(locale, "/account"))}`);
  if (!portal.account) redirect(localePath(locale, "/account"));
  const supabase = await userClient();
  const { error } = await supabase.rpc("set_weekly_order", { p_account: portal.account.id, p_on: on });
  if (error) {
    console.error("[portal] set_weekly_order failed:", error.code, error.message);
    weeklyNote(locale, "failed");
  }
  await sendWeeklyChangedEmail({
    accountName: portal.account.name,
    changedBy: portal.user.email ?? "",
    on,
    deliveryDay: portal.account.deliveryDay ? DAY_NAMES[portal.account.deliveryDay] : null,
  });
  weeklyNote(locale, on ? "asked" : "off");
}

/** Skips the coming delivery of the weekly order, or takes the skip back. */
export async function skipWeekly(form: FormData): Promise<void> {
  const locale = readLocale(form);
  const skip = form.get("skip") === "1";
  const portal = await getPortal();
  if (!portal) redirect(`${localePath(locale, "/account/sign-in")}?next=${encodeURIComponent(localePath(locale, "/account"))}`);
  if (!portal.account) redirect(localePath(locale, "/account"));
  const supabase = await userClient();
  const { error } = await supabase.rpc("skip_weekly_order", { p_account: portal.account.id, p_skip: skip });
  if (error) {
    console.error("[portal] skip_weekly_order failed:", error.code, error.message);
    weeklyNote(locale, "failed");
  }
  weeklyNote(locale, skip ? "skipped" : "unskipped");
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

/**
 * Keeps only SKUs the catalog lists, whole cases from 1 to 999, first line per SKU.
 * Lines for items that are not for sale right now are set aside, so the customer
 * hears about them instead of getting an order that quietly leaves them out.
 */
async function cleanLines(input: unknown): Promise<{ lines: { sku: string; cases: number }[]; unavailable: string[] }> {
  const lines: { sku: string; cases: number }[] = [];
  const unavailable: string[] = [];
  if (!Array.isArray(input)) return { lines, unavailable };
  const shelf = await getShelfNow();
  const seen = new Set<string>();
  for (const raw of input.slice(0, 150)) {
    if (!raw || typeof raw !== "object") continue;
    const { sku, cases } = raw as { sku?: unknown; cases?: unknown };
    if (typeof sku !== "string" || seen.has(sku) || !findVariant(sku)) continue;
    if (typeof cases !== "number" || !Number.isInteger(cases) || cases < 1 || cases > 999) continue;
    seen.add(sku);
    if (shelf.has(sku)) lines.push({ sku, cases });
    else unavailable.push(sku);
  }
  return { lines, unavailable };
}

/** Some lines are for items that went off sale: nothing was ordered or saved. */
type Unavailable = { ok: false; reason: "unavailable"; skus: string[] };

export type PlaceOrderResult =
  | { ok: true; number: number; total: number | null }
  | { ok: false; reason: "signin" | "noAccount" | "empty" | "generic" }
  | Unavailable;

export async function placeOrder(input: {
  locale: string;
  lines: unknown;
  note: unknown;
  nextDay: unknown;
}): Promise<PlaceOrderResult> {
  const portal = await getPortal();
  if (!portal) return { ok: false, reason: "signin" };
  if (!portal.account) return { ok: false, reason: "noAccount" };
  const { lines, unavailable } = await cleanLines(input.lines);
  if (unavailable.length) return { ok: false, reason: "unavailable", skus: unavailable };
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

  // What the database saved: the fees and the price on each line, for the team's email.
  const { data: saved } = await supabase
    .from("orders")
    .select("delivery_fee, next_day_fee, pay_token, order_lines(sku, cases, price_per_case)")
    .eq("id", row.order_id)
    .maybeSingle();
  const savedLines = (saved?.order_lines ?? []) as { sku: string; price_per_case: number | string | null }[];
  const priceOf = new Map(savedLines.map((l) => [l.sku, l.price_per_case == null ? null : Number(l.price_per_case)]));
  await sendOrderEmail({
    number,
    accountName: portal.account.name,
    placedBy: portal.user.email ?? "",
    note,
    lines: lines.map((l) => ({ ...l, price: priceOf.get(l.sku) ?? null })),
    subtotal: row.order_subtotal == null ? null : Number(row.order_subtotal),
    nextDay,
    deliveryFee: saved?.delivery_fee == null ? null : Number(saved.delivery_fee),
    nextDayFee: saved?.next_day_fee == null ? null : Number(saved.next_day_fee),
    total,
    payUrl: paymentsReady() && typeof saved?.pay_token === "string" ? payUrl(locale, saved.pay_token) : null,
  });
  return { ok: true, number, total };
}

export type SaveUsualResult =
  | { ok: true; count: number }
  | { ok: false; reason: "signin" | "noAccount" | "generic" }
  | Unavailable;

export async function saveUsualOrder(input: ListInput): Promise<SaveUsualResult> {
  const portal = await getPortal();
  if (!portal) return { ok: false, reason: "signin" };
  if (!portal.account) return { ok: false, reason: "noAccount" };
  const { lines, unavailable } = await cleanLines(input.lines);
  if (unavailable.length) return { ok: false, reason: "unavailable", skus: unavailable };
  const supabase = await userClient();
  const { data, error } = await supabase.rpc("save_usual_order", {
    p_account: portal.account.id,
    p_lines: lines,
  });
  if (error) {
    console.error("[portal] save_usual_order failed:", error.code, error.message);
    return { ok: false, reason: "generic" };
  }
  return { ok: true, count: Number(data ?? 0) };
}
