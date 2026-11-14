/**
 * What delivery costs, as public.pricing sets it: a fee, and the subtotal from which delivery is free
 * ($20 under $200 since Nov 13, 2026). Null `freeFrom` means the fee applies to every order.
 *
 * Everything here is for reading only (the list, its order bar, the order guide's card). The database
 * works the fee out again when an order is placed (`place_order`), and that is what the order is charged.
 */
export interface DeliveryTerms {
  delivery: number;
  freeFrom: number | null;
}

const cents = (n: number) => Math.round(n * 100);

/** The delivery fee on an order whose products come to `subtotal`. */
export function deliveryFor(subtotal: number, terms: DeliveryTerms): number {
  return terms.freeFrom != null && cents(subtotal) >= cents(terms.freeFrom) ? 0 : terms.delivery;
}

/**
 * How much more to add for free delivery: 0 once the order gets it, null when no amount would change
 * the fee (no threshold, or no fee to waive).
 */
export function leftForFree(subtotal: number, terms: DeliveryTerms): number | null {
  if (terms.freeFrom == null || terms.delivery <= 0) return null;
  return Math.max(0, cents(terms.freeFrom) - cents(subtotal)) / 100;
}
