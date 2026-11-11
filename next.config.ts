import type { NextConfig } from "next";

/**
 * Content security policy: the browser loads scripts, styles, images, fonts and data
 * only from this site, and no other site may frame it or receive its forms.
 *
 * Next writes small inline scripts and styles into every page, and the pages are
 * built ahead of time, so they cannot carry a per-request nonce. "unsafe-inline"
 * allows those; the policy still shuts out scripts and styles from other hosts.
 *
 * Preview deployments also allow Vercel's review toolbar. `next dev` gets no policy,
 * because its reload tooling needs eval and a websocket.
 */
function contentSecurityPolicy(): string {
  const preview = process.env.VERCEL_ENV === "preview";
  const live = preview ? " https://vercel.live" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${live}`,
    `style-src 'self' 'unsafe-inline'${live}`,
    `img-src 'self' data: blob:${preview ? " https://vercel.live https://vercel.com" : ""}`,
    `font-src 'self'${preview ? " https://vercel.live https://assets.vercel.com" : ""}`,
    `connect-src 'self'${preview ? " https://vercel.live wss://ws-us3.pusher.com" : ""}`,
    ...(preview ? ["frame-src 'self' https://vercel.live"] : []),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Content-Security-Policy", value: contentSecurityPolicy() }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
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
