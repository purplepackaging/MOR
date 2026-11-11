"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { checkSession } from "@/lib/session-check";
import { showToast } from "./Toaster";

/**
 * Says once that a new account is ready. The business form sends the customer
 * to the products with ?welcome=1; the mark comes off the address right away,
 * so a reload or a shared link does not say it again. Only someone who is
 * signed in hears it.
 */
export function Welcome({ message }: { message: string }) {
  const pathname = usePathname();
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("welcome")) return;
    url.searchParams.delete("welcome");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    void checkSession(pathname).then((signedIn) => {
      if (signedIn) showToast({ message }, 8000);
    });
  }, [message, pathname]);
  return null;
}
