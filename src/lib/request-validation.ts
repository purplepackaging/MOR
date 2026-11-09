import { isLocale, type Locale } from "./i18n";

export const BUSINESS_TYPES = ["restaurant", "cafe", "caterer", "hotel", "foodTruck", "market", "other"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const CHANNELS = ["online", "text", "whatsapp", "rep"] as const;
export type Channel = (typeof CHANNELS)[number];

export type FieldKey = "businessName" | "businessType" | "contactName" | "phone" | "email" | "street" | "city" | "zip";
export type ErrorCode = "required" | "chooseType" | "phone" | "zip" | "email";

export interface RequestValues {
  businessName: string;
  businessType: string;
  contactName: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  zip: string;
  language: string;
  repCode: string;
  channels: string[];
  notes: string;
  smsConsent: boolean;
}

export interface CleanRequest {
  businessName: string;
  businessType: BusinessType;
  contactName: string;
  phone: string; // E.164
  email: string | null;
  street: string;
  city: string;
  zip: string;
  language: Locale;
  repCode: string | null;
  channels: Channel[];
  notes: string | null;
  smsConsent: boolean;
}

const clip = (s: string, n: number) => s.trim().replace(/\s+/g, " ").slice(0, n);

/** Accepts (404) 555-0123, 404.555.0123, +1 404 555 0123. Returns +14045550123 or null. */
export function normalizeUsPhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10 || /^[01]/.test(digits)) return null;
  return `+1${digits}`;
}

export function formatUsPhone(e164: string): string {
  const d = e164.replace(/^\+1/, "");
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function validateRequest(v: RequestValues): {
  errors: Partial<Record<FieldKey, ErrorCode>>;
  clean: CleanRequest | null;
} {
  const errors: Partial<Record<FieldKey, ErrorCode>> = {};
  const businessName = clip(v.businessName, 120);
  const contactName = clip(v.contactName, 80);
  const street = clip(v.street, 160);
  const city = clip(v.city, 80);
  const zip = v.zip.trim();
  const email = v.email.trim().slice(0, 160);
  const phone = normalizeUsPhone(v.phone);

  if (!businessName) errors.businessName = "required";
  if (!(BUSINESS_TYPES as readonly string[]).includes(v.businessType)) errors.businessType = "chooseType";
  if (!contactName) errors.contactName = "required";
  if (!v.phone.trim()) errors.phone = "required";
  else if (!phone) errors.phone = "phone";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = "email";
  if (!street) errors.street = "required";
  if (!city) errors.city = "required";
  if (!zip) errors.zip = "required";
  else if (!/^\d{5}(-\d{4})?$/.test(zip)) errors.zip = "zip";

  if (Object.keys(errors).length) return { errors, clean: null };

  return {
    errors,
    clean: {
      businessName,
      businessType: v.businessType as BusinessType,
      contactName,
      phone: phone!,
      email: email || null,
      street,
      city,
      zip: zip.slice(0, 5),
      language: isLocale(v.language) ? v.language : "en",
      repCode: v.repCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || null,
      channels: v.channels.filter((c): c is Channel => (CHANNELS as readonly string[]).includes(c)),
      notes: v.notes.trim().slice(0, 1000) || null,
      smsConsent: v.smsConsent,
    },
  };
}

export function valuesFromForm(form: FormData): RequestValues {
  const s = (k: string) => {
    const x = form.get(k);
    return typeof x === "string" ? x : "";
  };
  return {
    businessName: s("businessName"),
    businessType: s("businessType"),
    contactName: s("contactName"),
    phone: s("phone"),
    email: s("email"),
    street: s("street"),
    city: s("city"),
    zip: s("zip"),
    language: s("language"),
    repCode: s("repCode"),
    channels: form.getAll("channels").filter((x): x is string => typeof x === "string"),
    notes: s("notes"),
    smsConsent: form.get("smsConsent") === "on",
  };
}
