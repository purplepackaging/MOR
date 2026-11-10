import "server-only";
import { findVariant, variantSummary } from "@/lib/catalog";

/**
 * Emails the team when a customer places an order or creates an account. Uses
 * Resend's HTTP API when RESEND_API_KEY, ORDER_EMAIL_FROM and ORDER_EMAIL_TO are
 * set in Vercel; otherwise it only logs. A failed email never fails the customer's action.
 */
async function sendTeamEmail(subject: string, lines: string[], logLine: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ORDER_EMAIL_FROM;
  const to = process.env.ORDER_EMAIL_TO;
  if (!key || !from || !to) {
    console.info(`[notify] ${logLine}; email not configured`);
    return;
  }
  const text = lines.filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: to.split(",").map((s) => s.trim()).filter(Boolean), subject, text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error(`[notify] email failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  } catch (error) {
    console.error("[notify] email failed:", error);
  }
}

const money = (n: number) => `$${n.toFixed(2)}`;

export async function sendOrderEmail(order: {
  number: number;
  accountName: string;
  placedBy: string;
  note: string;
  lines: { sku: string; cases: number }[];
  subtotal: number | null;
  nextDay: boolean;
  deliveryFee: number | null;
  nextDayFee: number | null;
  total: number | null;
}): Promise<void> {
  const rows = order.lines.map((l) => {
    const found = findVariant(l.sku);
    const name = found ? `${found.product.name.en}, ${variantSummary(found.variant, "en")}` : l.sku;
    return `${String(l.cases).padStart(3)} cs  ${l.sku}  ${name}`;
  });
  await sendTeamEmail(
    `New order ${order.number}${order.nextDay ? " (next day)" : ""}: ${order.accountName}`,
    [
      `Order ${order.number} from ${order.accountName}`,
      `Placed by ${order.placedBy}`,
      order.nextDay ? "NEXT-DAY DELIVERY requested" : "",
      "",
      ...rows,
      "",
      order.subtotal == null ? "Subtotal: to be confirmed" : `Subtotal: ${money(order.subtotal)}`,
      order.deliveryFee == null ? "" : `Delivery: ${money(order.deliveryFee)}`,
      order.nextDay && order.nextDayFee != null ? `Next-day delivery: ${money(order.nextDayFee)}` : "",
      order.total == null ? "Total: to be confirmed" : `Total: ${money(order.total)}`,
      order.note ? `Note: ${order.note}` : "",
      "",
      "Confirm it in Supabase: Table Editor > orders > status.",
    ],
    `order ${order.number} placed by ${order.accountName}`,
  );
}

export async function sendNewAccountEmail(account: {
  businessName: string;
  businessType: string | null;
  contactName: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  zip: string;
  language: string;
  repCode: string | null;
}): Promise<void> {
  await sendTeamEmail(
    `New account: ${account.businessName}`,
    [
      `${account.businessName} created an account on morsupply.com.`,
      "",
      `Contact: ${account.contactName}`,
      `Phone: ${account.phone}`,
      `Email: ${account.email}`,
      `Address: ${account.street}, ${account.city} ${account.zip}`,
      account.businessType ? `Type: ${account.businessType}` : "",
      `Language: ${account.language}`,
      account.repCode ? `Rep code: ${account.repCode}` : "",
      "",
      "They can see prices and order now. Switch the account off in Supabase (Table Editor > accounts > active) if it isn't a real business.",
    ],
    `new account ${account.businessName}`,
  );
}
