import "server-only";
import { cache } from "react";
import { site } from "@/config/site";
import { serverRest, supabaseConfigured } from "./supabase";

/**
 * Which SKUs are for sale right now: the ones that have a cost in Supabase, so
 * everything a customer can see has a price. An item without a cost stays off the
 * site until its cost is loaded, then shows up by itself within a few minutes.
 *
 * Only SKUs come back from the database, never a cost or the margin.
 */

/** Seconds before pages ask Supabase again. The tests shorten it. */
const TTL = Number(process.env.AVAILABILITY_TTL_SECONDS) || 300;

/** Off when the portal is off (nobody sees prices then), or with SHOW_UNPRICED=true. */
export function hidesUnpriced(): boolean {
  return site.portalEnabled && process.env.SHOW_UNPRICED !== "true" && supabaseConfigured();
}

/** `fresh` skips the cache and asks Supabase now. */
async function pricedSkus(fresh = false): Promise<string[]> {
  const { base, headers } = serverRest();
  let problem: unknown;
  // One retry: a single dropped connection should not fail a build or a page refresh.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${base}/rpc/priced_skus`, {
        headers,
        ...(fresh ? { cache: "no-store" as const } : { next: { revalidate: TTL, tags: ["availability"] } }),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(`priced_skus answered ${res.status}`);
      const data: unknown = await res.json();
      if (!Array.isArray(data) || !data.every((sku) => typeof sku === "string")) {
        throw new Error("priced_skus sent something other than a list of SKUs");
      }
      return data;
    } catch (error) {
      problem = error;
    }
  }
  throw problem;
}

/** The last answer this server got, for the moments when Supabase cannot be reached. */
let lastGood: ReadonlySet<string> | null | undefined;

/**
 * The SKUs for sale, or null when nothing is hidden (hiding is off, or no cost has
 * been loaded yet).
 *
 * Throws when Supabase cannot be reached. Pages built ahead of time want that: a
 * failed refresh keeps the last good page, and a failed build keeps the last good
 * deploy, so a hiccup never puts unpriced items on show. Pages rendered per request
 * use getAvailableOrAll instead.
 */
export const getAvailable = cache(async (): Promise<ReadonlySet<string> | null> => {
  if (!hidesUnpriced()) return null;
  const skus = await pricedSkus();
  lastGood = skus.length ? new Set(skus) : null;
  return lastGood;
});

/**
 * For the footer, pages rendered per request and server actions: never fails. When
 * Supabase cannot be reached it carries on with the last answer this server got, or
 * with the whole catalog if it has none yet. Ordering needs Supabase as well, so this
 * rarely lets an unpriced item through; one that does get ordered shows "To be
 * confirmed", as it did before items were hidden.
 */
export const getAvailableOrAll = cache(async (): Promise<ReadonlySet<string> | null> => {
  try {
    return await getAvailable();
  } catch (error) {
    const fallback = lastGood === undefined ? "the whole catalog" : "the last list";
    console.error(`[availability] could not read priced SKUs, using ${fallback}:`, error);
    return lastGood ?? null;
  }
});

/**
 * For placing and saving orders: asks Supabase at that moment, so an item that went
 * off sale a minute ago cannot be ordered from a page that still shows it. Never fails.
 */
export async function getAvailableNow(): Promise<ReadonlySet<string> | null> {
  if (!hidesUnpriced()) return null;
  try {
    const skus = await pricedSkus(true);
    lastGood = skus.length ? new Set(skus) : null;
    return lastGood;
  } catch {
    return getAvailableOrAll();
  }
}
