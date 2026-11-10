import { NextResponse } from "next/server";
import { portalReady, userClient } from "@/lib/portal";

/** Tells the header whether to show "Sign in" or "Your account". Never cached. */
export async function GET() {
  let signedIn = false;
  if (portalReady()) {
    const supabase = await userClient();
    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data.user);
  }
  return NextResponse.json({ signedIn }, { headers: { "Cache-Control": "private, no-store" } });
}
