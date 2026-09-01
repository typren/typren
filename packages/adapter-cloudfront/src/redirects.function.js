// CloudFront Function (viewer-request, cloudfront-js-2.0 runtime) for a
// static-export site on an S3 REST origin. It does THREE jobs, and a
// distribution can carry only ONE viewer-request function, so all three
// live here:
//
//   1. KVS-backed redirect lookup -> 301. Exact-path lookup; trailing
//      slashes are normalized before lookup so both `/x` and `/x/` match.
//      The redirect MAP is NOT in this file — it lives in the CloudFront
//      KeyValueStore associated with this function at deploy time (see
//      `typren-cloudfront bootstrap`/`sync-redirects`). This file's code
//      never changes for a redirect edit.
//   2. Directory index rewrite. The S3 REST origin has no index-document
//      behaviour, so `/about/` asks for the key `about/` and 404s — the real
//      object is `about/index.html`. `output: "export"` + `trailingSlash:
//      true` means EVERY page is a directory like this, so without this
//      rewrite the whole site 404s except `/`. Do not drop this half — a
//      2026-08-18 outage on a typren-adjacent site was exactly this: a
//      redirects-only function replaced the one that did this rewrite.
//   3. Bare page form -> 301 to the slash form, so a legacy indexed URL (or
//      this site's own sitemap entries) keeps resolving. A small set of
//      well-known Next.js metadata file-convention routes are extensionless
//      REAL objects and must fall through untouched (see PASSTHROUGH below).
//
// If the KeyValueStore is unavailable, only job 1 degrades — jobs 2 and 3
// keep the site serving. See redirects.function.test.ts for the fail-open
// coverage.
import cf from "cloudfront";

const kvs = cf.kvs();

// Extensionless routes Next.js's static export emits for its file-convention
// metadata APIs (opengraph-image, twitter-image, icon, apple-icon). These are
// real S3 objects, not directories, and must never be redirected or rewritten.
var PASSTHROUGH = {
  "/opengraph-image": true,
  "/twitter-image": true,
  "/icon": true,
  "/apple-icon": true,
};

async function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var key = uri.length > 1 && uri.charAt(uri.length - 1) === "/" ? uri.slice(0, -1) : uri;

  // kvs.get() rejects when the key is absent — a miss just means "no
  // redirect here". Any OTHER store failure must degrade the same way:
  // losing redirects is an inconvenience, breaking the rewrite below is an
  // outage. Never let a KVS error escape this block.
  var target = null;
  try {
    target = await kvs.get(key);
  } catch (e) {
    target = null;
  }
  if (target) {
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: { location: { value: target } },
    };
  }

  // The canonical form is the trailing slash (`trailingSlash: true`).
  if (uri.charAt(uri.length - 1) === "/") {
    request.uri = uri + "index.html";
    return request;
  }

  // Bare page form (`/about`): 301 to the canonical slash form rather than
  // serving a page at two URLs. Real extensionless objects fall through.
  if (!PASSTHROUGH[uri] && uri.substring(uri.lastIndexOf("/")).indexOf(".") === -1) {
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: { location: { value: uri + "/" } },
    };
  }

  return request;
}
