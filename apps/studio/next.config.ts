import type { NextConfig } from "next";
import { studioHeaders } from "./lib/headers";

// The media adapter writes into the site's public/img and stores "/img/..."
// URLs, which resolve on the site. The studio is another origin, so its
// thumbnails proxy those paths through to the site's dev server.
// ponytail: only "/img" is proxied, whatever `studio.media.publicPath` says.
// Once the editor resolves relative media URLs against the preview origin,
// this rewrite can go.
const siteUrl = process.env.TYPREN_STUDIO ? (JSON.parse(process.env.TYPREN_STUDIO) as { siteUrl: string }).siteUrl : null;

const nextConfig: NextConfig = {
  // The studio is a packaged app, not a project an agent edits in place.
  agentRules: false,
  // The editor's theme picker sits bottom-left, where the dev badge defaults.
  devIndicators: { position: "bottom-right" },
  async headers() {
    return studioHeaders;
  },
  async rewrites() {
    return siteUrl ? [{ source: "/img/:path*", destination: `${siteUrl}/img/:path*` }] : [];
  },
};

export default nextConfig;
