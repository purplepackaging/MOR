import "server-only";

/**
 * Minimal Supabase REST client for server code. The secret key never reaches
 * the browser: it is read from Vercel environment variables at request time.
 * Tables have row level security on with no public policies, so only this
 * server key can read or write them.
 */

export function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase is not configured");
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  // Legacy service_role keys are JWTs and also go in the Authorization header.
  // New sb_secret_ keys are not JWTs and only go in the apikey header.
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  return { base: `${url.replace(/\/+$/, "")}/rest/v1`, headers };
}

/** Inserts one row. Returns false (and logs why) instead of throwing. */
export async function insertRow(table: string, row: Record<string, unknown>): Promise<boolean> {
  try {
    const { base, headers } = config();
    const res = await fetch(`${base}/${encodeURIComponent(table)}`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(row),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      console.error(`[supabase] insert into ${table} failed: ${res.status} ${detail}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[supabase] insert into ${table} failed:`, error);
    return false;
  }
}
