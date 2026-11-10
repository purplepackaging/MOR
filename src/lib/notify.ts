import "server-only";
import { findVariant, variantSummary } from "@/lib/catalog";

/**
 * Emails the team when a customer places an order. Uses Resend's HTTP API when
 * RESEND_API_KEY, ORDER_EMAIL_FROM and ORDER_EMAIL_TO are set in Vercel;
 * otherwise it only logs. A failed email never fails the order.
 */
export async function sendOrderEmail(order: {
  number: number;
  accountName: string;
  placedBy: string;
  note: string;
  lines: { sku: string; cases: number }[];
  subtotal: number | null;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ORDER_EMAIL_FROM;
  const to = process.env.ORDER_EMAIL_TO;
  if (!key || !from || !to) {
    console.info(`[notify] order ${order.number} placed by ${order.accountName}; email not configured`);
    return;
  }

  const money = (n: number) => `$${n.toFixed(2)}`;
  const rows = order.lines.map((l) => {
    const found = findVariant(l.sku);
    const name = found ? `${found.product.name.en}, ${variantSummary(found.variant, "en")}` : l.sku;
    return `${String(l.cases).padStart(3)} cs  ${l.sku}  ${name}`;
  });
  const text = [
    `Order ${order.number} from ${order.accountName}`,
    `Placed by ${order.placedBy}`,
    "",
    ...rows,
    "",
    order.subtotal == null ? "Subtotal: to be confirmed" : `Subtotal: ${money(order.subtotal)}`,
    order.note ? `Note: ${order.note}` : "",
    "",
    "Update the status in Supabase: Table Editor > orders.",
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: to.split(",").map((s) => s.trim()).filter(Boolean),
        subject: `New order ${order.number}: ${order.accountName}`,
        text,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error(`[notify] order email failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  } catch (error) {
    console.error("[notify] order email failed:", error);
  }
}
