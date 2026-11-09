"use server";

import { cookies, headers } from "next/headers";
import { normalizeRepCode } from "@/config/reps";
import { REP_COOKIE } from "@/config/site";
import { getDictionary } from "@/i18n";
import { findVariant, variantSummary } from "@/lib/catalog";
import { isLocale, type Locale } from "@/lib/i18n";
import {
  formatUsPhone,
  validateRequest,
  valuesFromForm,
  type ErrorCode,
  type FieldKey,
} from "@/lib/request-validation";
import { insertRow, supabaseConfigured } from "@/lib/supabase";

export type SubmitResult =
  | { ok: true; name: string; phone: string }
  | { ok: false; reason: "invalid"; errors: Partial<Record<FieldKey, ErrorCode>> }
  | { ok: false; reason: "notReady" | "generic" };

const MAX_ITEMS = 150;

/** The visitor's list, checked against the catalog. Unknown SKUs are dropped. */
function parseItems(raw: FormDataEntryValue | null) {
  if (typeof raw !== "string" || !raw || raw.length > 20_000) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const items: { sku: string; cases: number; name: string; option: string }[] = [];
  for (const entry of parsed.slice(0, MAX_ITEMS)) {
    if (!entry || typeof entry !== "object") continue;
    const { sku, cases } = entry as { sku?: unknown; cases?: unknown };
    if (typeof sku !== "string" || seen.has(sku)) continue;
    if (typeof cases !== "number" || !Number.isInteger(cases) || cases < 1 || cases > 999) continue;
    const found = findVariant(sku);
    if (!found) continue;
    seen.add(sku);
    items.push({ sku, cases, name: found.product.name.en, option: variantSummary(found.variant, "en") });
  }
  return items;
}

export async function submitAccountRequest(form: FormData): Promise<SubmitResult> {
  // Honeypot: people never see or fill this field, bots often do.
  if (String(form.get("website") ?? "").trim()) return { ok: true, name: "", phone: "" };

  const rawLocale = String(form.get("siteLocale") ?? "");
  const siteLocale: Locale = isLocale(rawLocale) ? rawLocale : "en";

  const { errors, clean } = validateRequest(valuesFromForm(form));
  if (!clean) return { ok: false, reason: "invalid", errors };

  if (!supabaseConfigured()) return { ok: false, reason: "notReady" };

  const jar = await cookies();
  const h = await headers();
  const repCode = clean.repCode ?? (normalizeRepCode(jar.get(REP_COOKIE)?.value) || null);
  const consentAt = clean.smsConsent ? new Date().toISOString() : null;

  const saved = await insertRow("account_requests", {
    business_name: clean.businessName,
    business_type: clean.businessType,
    contact_name: clean.contactName,
    phone: clean.phone,
    email: clean.email,
    street: clean.street,
    city: clean.city,
    zip: clean.zip,
    preferred_language: clean.language,
    site_locale: siteLocale,
    rep_code: repCode,
    channels: clean.channels,
    notes: clean.notes,
    items: parseItems(form.get("items")),
    sms_consent: clean.smsConsent,
    // Keep the exact wording the person agreed to, in the language they saw it.
    sms_consent_text: clean.smsConsent ? getDictionary(siteLocale).request.sms : null,
    sms_consent_at: consentAt,
    client_ip: (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null,
    user_agent: (h.get("user-agent") ?? "").slice(0, 300) || null,
  });

  if (!saved) return { ok: false, reason: "generic" };
  return { ok: true, name: clean.contactName, phone: formatUsPhone(clean.phone) };
}
