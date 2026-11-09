/**
 * Sales reps and the codes printed on their flyers.
 * The flyer QR code points to https://morsupply.com/r/CODE.
 * Unknown codes are still saved with the request, so nothing is lost
 * if a rep starts handing out flyers before they are added here.
 *
 * Example: ALI: { name: "Ali" },
 */
export const reps: Record<string, { name: string }> = {};

export function normalizeRepCode(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

export function repDisplayName(code: string): string {
  return reps[code]?.name ?? code;
}
