import { NextResponse } from "next/server";
import { getPortal, getPrices, portalReady } from "@/lib/portal";

/**
 * A signed-in customer's prices per case, for the static product pages.
 * The prices come from my_prices() in Postgres; nothing is worked out here.
 * Never cached. Signed-out visitors and switched-off accounts get no prices.
 */
export async function GET() {
  let status: "out" | "paused" | "soon" | "ok" = "out";
  let prices: Record<string, number> | null = null;
  if (portalReady()) {
    const portal = await getPortal();
    if (portal?.account) {
      prices = await getPrices(portal.account.id);
      status = prices ? "ok" : "soon";
    } else if (portal?.paused) {
      status = "paused";
    }
  }
  return NextResponse.json({ status, prices }, { headers: { "Cache-Control": "private, no-store" } });
}
