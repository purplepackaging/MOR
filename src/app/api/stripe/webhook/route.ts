import { NextResponse } from "next/server";
import { sendDisputeEmail } from "@/lib/notify";
import { recordPayment } from "@/lib/payments";
import { getPaymentIntent, paymentsReady, sameMode, verifyWebhook, type Dispute, type PaymentIntent } from "@/lib/stripe";

/**
 * Stripe tells the site here when a payment comes in, starts, fails or is disputed. In the
 * Stripe Dashboard: Developers > Webhooks > Add destination, this URL
 * (https://morsupply.com/api/stripe/webhook) and these events:
 *   payment_intent.succeeded, payment_intent.processing, payment_intent.payment_failed,
 *   payment_intent.canceled, charge.dispute.created
 * Its signing secret goes in Vercel as STRIPE_WEBHOOK_SECRET.
 *
 * Anything but a 2xx makes Stripe send the event again (for up to 3 days), so a moment when
 * Supabase cannot be reached answers 500. Repeated events change nothing the second time.
 */

const PAYMENT_EVENTS = new Set([
  "payment_intent.succeeded",
  "payment_intent.processing",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
]);

interface StripeEvent {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: unknown };
}

export async function POST(request: Request) {
  if (!paymentsReady()) return NextResponse.json({ error: "payments are off" }, { status: 404 });
  const payload = await request.text();
  if (!verifyWebhook(payload, request.headers.get("stripe-signature"))) {
    return NextResponse.json({ error: "signature does not match" }, { status: 400 });
  }
  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "not JSON" }, { status: 400 });
  }
  // A test event never touches the orders of a site that takes live payments, and the other way round.
  if (!sameMode(event.livemode)) return NextResponse.json({ received: true });

  try {
    if (PAYMENT_EVENTS.has(event.type)) {
      // Payments made from a pay link name their order; others (made in the Dashboard) are left alone.
      await recordPayment(event.data.object as PaymentIntent);
    } else if (event.type === "charge.dispute.created") {
      const dispute = event.data.object as Dispute;
      const intent = dispute.payment_intent ? await getPaymentIntent(dispute.payment_intent).catch(() => null) : null;
      const number = Number(intent?.metadata?.order_number);
      await sendDisputeEmail({
        number: Number.isSafeInteger(number) && number > 0 ? number : null,
        accountName: intent?.metadata?.business ?? null,
        amount: dispute.amount / 100,
        reason: dispute.reason ?? "unknown",
        intentId: dispute.payment_intent,
      });
    }
  } catch (error) {
    console.error(`[stripe] ${event.type} ${event.id} could not be recorded:`, error);
    return NextResponse.json({ error: "try again" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
