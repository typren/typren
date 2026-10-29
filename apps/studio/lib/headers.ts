/** Response headers for the studio's own routes. The studio's API trusts its
 *  origin (ambient loopback auth, no token), so nothing may frame it, and the
 *  `/img` proxy must never serve a site file as an active document there: an
 *  SVG or HTML file that reached `public/img` without going through upload
 *  would otherwise run script with the studio's authority. The CSP on images
 *  does not affect `<img>` rendering; it applies only when one is opened as a
 *  document. Nothing in the studio frames the studio itself (the preview and
 *  section frames point at the site's origin), hence DENY over SAMEORIGIN. */
export const studioHeaders = [
  {
    source: "/:path*",
    headers: [
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ],
  },
  {
    source: "/img/:path*",
    headers: [
      {
        key: "Content-Security-Policy",
        value: "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'none'",
      },
    ],
  },
];
