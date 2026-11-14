import "server-only";
import { findVariant, variantSummary } from "@/lib/catalog";

/**
 * Emails the team when a customer places an order or creates an account. Uses
 * Resend's HTTP API when RESEND_API_KEY, ORDER_EMAIL_FROM and ORDER_EMAIL_TO are
 * set in Vercel; otherwise it only logs. A failed email never fails the customer's action.
 */
/** One line of an email. "" is a blank line; null is a line that does not apply and leaves no gap. */
type Line = string | null;

/** Drops the lines that do not apply, then never leaves two blank lines in a row. */
function body(lines: Line[]): string {
  return lines
    .filter((line): line is string => line !== null)
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
}

async function sendTeamEmail(subject: string, lines: Line[], logLine: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ORDER_EMAIL_FROM;
  const to = process.env.ORDER_EMAIL_TO;
  if (!key || !from || !to) {
    console.info(`[notify] ${logLine}; email not configured`);
    return;
  }
  const text = body(lines);
  // The tests point this at a stand-in. Everywhere else it is Resend.
  const api = process.env.RESEND_API_URL ?? "https://api.resend.com";
  try {
    const res = await fetch(`${api}/emails`, {
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
  /** What the order holds, with the price per case the database saved on each line. */
  lines: { sku: string; cases: number; price: number | null }[];
  subtotal: number | null;
  nextDay: boolean;
  deliveryFee: number | null;
  nextDayFee: number | null;
  total: number | null;
  /** The order's pay link, while the site takes payments. Text it to the customer at delivery. */
  payUrl?: string | null;
}): Promise<void> {
  const rows = order.lines.map((l) => {
    const found = findVariant(l.sku);
    const name = found ? `${found.product.name.en}, ${variantSummary(found.variant, "en")}` : l.sku;
    // The saved price times the cases, in cents so the line agrees with the order page.
    const amount =
      l.price == null
        ? "price to be confirmed"
        : `${money(l.price)} a case, ${money((Math.round(l.price * 100) * l.cases) / 100)}`;
    return `${String(l.cases).padStart(3)} cs  ${l.sku}  ${name}  |  ${amount}`;
  });
  await sendTeamEmail(
    `New order ${order.number}${order.nextDay ? " (next day)" : ""}: ${order.accountName}`,
    [
      `Order ${order.number} from ${order.accountName}`,
      `Placed by ${order.placedBy}`,
      order.nextDay ? "NEXT-DAY DELIVERY requested" : null,
      "",
      ...rows,
      "",
      order.subtotal == null ? "Subtotal: to be confirmed" : `Subtotal: ${money(order.subtotal)}`,
      order.deliveryFee == null ? null : `Delivery: ${money(order.deliveryFee)}`,
      order.nextDay && order.nextDayFee != null ? `Next-day delivery: ${money(order.nextDayFee)}` : null,
      order.total == null ? "Total: to be confirmed" : `Total: ${money(order.total)}`,
      order.note ? `Note: ${order.note}` : null,
      "",
      "Confirm it in Supabase: Table Editor > orders > status.",
      order.payUrl ? `Pay link (text it to the customer at delivery): ${order.payUrl}` : null,
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
      account.businessType ? `Type: ${account.businessType}` : null,
      `Language: ${account.language}`,
      account.repCode ? `Rep code: ${account.repCode}` : null,
      "",
      "They can see prices and order now. Switch the account off in Supabase (Table Editor > accounts > active) if it isn't a real business.",
    ],
    `new account ${account.businessName}`,
  );
}

/** A customer changed their business details. Only what changed is listed, old value then new. */
export async function sendDetailsChangedEmail(change: {
  accountName: string;
  changedBy: string;
  changes: { label: string; before: string; after: string }[];
}): Promise<void> {
  if (change.changes.length === 0) return;
  await sendTeamEmail(
    `Details changed: ${change.accountName}`,
    [
      `${change.accountName} changed its details on morsupply.com.`,
      `Changed by ${change.changedBy}`,
      "",
      ...change.changes.map((c) => `${c.label}: ${c.before || "(empty)"} -> ${c.after || "(empty)"}`),
      "",
      "Check the delivery day if the address moved.",
    ],
    `details changed ${change.accountName}`,
  );
}

/** A customer canceled an order that was still "received". */
export async function sendOrderCanceledEmail(order: {
  number: number;
  accountName: string;
  canceledBy: string;
}): Promise<void> {
  await sendTeamEmail(
    `Order ${order.number} canceled: ${order.accountName}`,
    [
      `${order.accountName} canceled order ${order.number} on morsupply.com before it was confirmed.`,
      `Canceled by ${order.canceledBy}`,
      "",
      "Nothing to deliver for this order. It reads Canceled in Supabase (Table Editor > orders).",
    ],
    `order ${order.number} canceled`,
  );
}

/** A customer asked for a weekly order, or turned it off. */
export async function sendWeeklyChangedEmail(change: {
  accountName: string;
  changedBy: string;
  on: boolean;
  /** "Thursday", or null when the account has no delivery day yet. */
  deliveryDay: string | null;
}): Promise<void> {
  await sendTeamEmail(
    change.on ? `Weekly order asked for: ${change.accountName}` : `Weekly order turned off: ${change.accountName}`,
    change.on
      ? [
          `${change.accountName} asked for a weekly order on morsupply.com.`,
          `Asked by ${change.changedBy}`,
          "",
          change.deliveryDay
            ? `Delivery day: ${change.deliveryDay}`
            : "No delivery day yet. Set one in Supabase (Table Editor > accounts > delivery_day).",
          "Nothing is placed automatically until weekly orders are switched on (pricing > weekly_orders_on).",
        ]
      : [
          `${change.accountName} turned its weekly order off on morsupply.com.`,
          `Turned off by ${change.changedBy}`,
        ],
    `weekly order ${change.on ? "asked for" : "turned off"} ${change.accountName}`,
  );
}

const METHOD_WORDS = { bank: "bank (ACH)", credit_card: "credit card", debit_card: "debit card", card: "card" } as const;

/**
 * Where a payment stands, for the team: the money is in, a bank payment is on its way, a
 * payment failed, or an order looks paid twice. Sent once for each change.
 */
export async function sendPaymentEmail(p: {
  kind: "paid" | "processing" | "failed" | "twice";
  number: number;
  accountName: string;
  method: keyof typeof METHOD_WORDS;
  /** What the payment comes to, card fee included. */
  amount: number;
  cardFee: number;
  intentId: string;
  /** Stripe's reason, when a payment failed. */
  reason: string | null;
  orderCanceled: boolean;
  payUrl: string;
}): Promise<void> {
  const by = `${money(p.amount)} by ${METHOD_WORDS[p.method]}`;
  const fee = p.cardFee > 0 ? `Includes the credit card fee: ${money(p.cardFee)} on ${money(Math.round((p.amount - p.cardFee) * 100) / 100)}.` : null;
  const stripe = `In Stripe: search for ${p.intentId}`;
  const canceled = p.orderCanceled ? "This order is canceled: refund the payment in Stripe (Payments > the payment > Refund)." : null;
  const content: Record<typeof p.kind, { subject: string; lines: (string | null)[] }> = {
    paid: {
      subject: `Paid: order ${p.number}, ${p.accountName}, ${money(p.amount)}`,
      lines: [`${p.accountName} paid order ${p.number}: ${by}.`, fee, canceled, "", stripe],
    },
    processing: {
      subject: `Bank payment on its way: order ${p.number}, ${p.accountName}, ${money(p.amount)}`,
      lines: [
        `${p.accountName} started a bank payment for order ${p.number}: ${by}.`,
        "It takes about 4 business days to arrive. You get another email when it does, or if it fails.",
        canceled,
        "",
        stripe,
      ],
    },
    failed: {
      subject: `Payment failed: order ${p.number}, ${p.accountName}`,
      lines: [
        `The payment of ${money(p.amount)} for order ${p.number} from ${p.accountName} did not go through.`,
        p.reason ? `Stripe says: ${p.reason}` : null,
        "",
        `The customer can pay again with the same link: ${p.payUrl}`,
        "",
        stripe,
      ],
    },
    twice: {
      subject: `Paid twice? Order ${p.number}, ${p.accountName}`,
      lines: [
        `Order ${p.number} from ${p.accountName} has another payment: ${by}.`,
        fee,
        "Check the order's payments in Stripe and refund one of them.",
        "",
        stripe,
      ],
    },
  };
  const { subject, lines } = content[p.kind];
  await sendTeamEmail(subject, lines, `order ${p.number} payment ${p.kind}`);
}

/** A customer's bank or card company disputed a payment. Stripe sets the deadline to respond. */
export async function sendDisputeEmail(d: {
  number: number | null;
  accountName: string | null;
  amount: number;
  reason: string;
  intentId: string | null;
}): Promise<void> {
  const who = d.number ? `order ${d.number}${d.accountName ? `, ${d.accountName}` : ""}` : "a payment";
  await sendTeamEmail(
    `Payment disputed: ${who}, ${money(d.amount)}`,
    [
      `The customer's bank or card company disputed ${money(d.amount)} for ${who} (reason: ${d.reason.replace(/_/g, " ")}).`,
      "The money is held back until it is settled. Answer it in Stripe (Payments > Disputes) before the deadline it shows.",
      "",
      d.intentId ? `In Stripe: search for ${d.intentId}` : null,
    ],
    `dispute ${who}`,
  );
}
