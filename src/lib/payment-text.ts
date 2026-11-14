import type { Dict } from "@/i18n";
import { fill, formatDate, formatMoney, type Locale } from "@/lib/i18n";
import type { Payment } from "@/lib/payments";

/**
 * Where an order's payment stands, in the reader's language: the sentences the order page
 * and the pay page show. "Not paid yet" is left to the page, which knows whether it can
 * offer to pay.
 */
export function paymentSentences(payment: Payment, locale: Locale, dict: Dict): string[] {
  const pay = dict.pay;
  const amount = payment.amount == null ? "" : formatMoney(locale, payment.amount);
  if (payment.status === "paid" && payment.method) {
    const sentences = [fill(pay.paidBy[payment.method], { amount, date: payment.paidAt ? formatDate(locale, payment.paidAt) : "" })];
    if (payment.cardFee) sentences.push(fill(pay.feeIncluded, { fee: formatMoney(locale, payment.cardFee) }));
    return sentences;
  }
  if (payment.status === "processing") {
    return [
      fill(pay.processingSince, { amount, date: payment.updatedAt ? formatDate(locale, payment.updatedAt) : "" }),
      pay.processingBody,
    ];
  }
  if (payment.status === "failed") return [pay.failed];
  return [];
}
