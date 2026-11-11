import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * How the sign-in cookie is set. Only the server ever reads it, so page scripts
 * must not see it (HttpOnly) and it must never travel over plain http (Secure).
 * The Supabase library leaves it readable by scripts by default, for apps that
 * sign in from the browser. This site never does.
 *
 * `next dev` runs on plain http, where Safari drops Secure cookies even on
 * localhost, so Secure is for built sites only (Vercel, and `next start` in tests).
 */
export const SESSION_COOKIE: CookieOptionsWithName = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
};
