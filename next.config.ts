import type { NextConfig } from "next";

/**
 * Content security policy: the browser loads scripts, styles, images, fonts and data
 * only from this site, and no other site may frame it or receive its forms.
 *
 * Next writes small inline scripts and styles into every page, and the pages are
 * built ahead of time, so they cannot carry a per-request nonce. "unsafe-inline"
 * allows those; the policy still shuts out scripts and styles from other hosts.
 *
 * The pay page (/pay/..., in every language) also loads Stripe.js and Stripe's frames, the hosts
 * Stripe lists for Stripe.js (docs.stripe.com/security/guide#content-security-policy):
 * js.stripe.com and *.js.stripe.com for the script and its frames, hooks.stripe.com for a
 * card's 3D Secure check, api.stripe.com for its calls. Every other page keeps Stripe out.
 *
 * Preview deployments also allow Vercel's review toolbar. `next dev` gets no policy,
 * because its reload tooling needs eval and a websocket.
 */
function contentSecurityPolicy({ stripe = false } = {}): string {
  const preview = process.env.VERCEL_ENV === "preview";
  const live = preview ? " https://vercel.live" : "";
  const stripeJs = stripe ? " https://js.stripe.com https://*.js.stripe.com" : "";
  const frames = [preview ? "https://vercel.live" : "", stripe ? "https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com" : ""]
    .filter(Boolean)
    .join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${live}${stripeJs}`,
    `style-src 'self' 'unsafe-inline'${live}`,
    `img-src 'self' data: blob:${preview ? " https://vercel.live https://vercel.com" : ""}`,
    `font-src 'self'${preview ? " https://vercel.live https://assets.vercel.com" : ""}`,
    `connect-src 'self'${preview ? " https://vercel.live wss://ws-us3.pusher.com" : ""}${stripe ? " https://api.stripe.com" : ""}`,
    ...(frames ? [`frame-src 'self' ${frames}`] : []),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

const production = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(production ? [{ key: "Content-Security-Policy", value: contentSecurityPolicy() }] : []),
];

/** The pay page's policy. A later rule that sets the same header wins, so this replaces the one above. */
const payHeaders = production ? [{ key: "Content-Security-Policy", value: contentSecurityPolicy({ stripe: true }) }] : [];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...(payHeaders.length
        ? [
            { source: "/pay/:path*", headers: payHeaders },
            { source: "/:locale(en|es|tr|ar)/pay/:path*", headers: payHeaders },
          ]
        : []),
      {
        source: "/fonts/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/img/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
    ];
  },
};

export default nextConfig;
