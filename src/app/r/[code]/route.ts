import { NextResponse, type NextRequest } from "next/server";
import { REP_COOKIE } from "@/config/site";
import { normalizeRepCode } from "@/config/reps";

const SIX_MONTHS = 60 * 60 * 24 * 180;

/**
 * Flyer QR codes point here: morsupply.com/r/ALI.
 * Saves the rep code, then opens the account request page in the visitor's language.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/r/[code]">) {
  const { code } = await ctx.params;
  const rep = normalizeRepCode(code);
  const target = new URL("/request-account", request.url);
  // Also pass the code in the URL, so attribution works when cookies are blocked.
  if (rep) target.searchParams.set("rep", rep);
  const res = NextResponse.redirect(target, 307);
  if (rep) {
    res.cookies.set(REP_COOKIE, rep, {
      path: "/",
      maxAge: SIX_MONTHS,
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
  }
  return res;
}
