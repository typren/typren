// Host-agnostic routing for a static-export site (`output: "export"` +
// `trailingSlash: true`): directory-index rewrite, bare->slash
// canonicalization, and a redirect-store lookup, in that semantic order.
// PURE: no node/browser globals, no imports from elsewhere in this package,
// so `@typren/adapter-cloudflare`'s Worker can import it directly.
// `@typren/adapter-cloudfront`'s hand-written `redirects.function.js` cannot
// import this (cloudfront-js has no bundler) and instead mirrors it by hand,
// held to the same semantics by `@typren/contract-tests`'
// `createStaticHostRoutingContractSuite` run against both.

export type StaticHostDecision =
  | { kind: "redirect"; status: 301; location: string }
  | { kind: "rewrite"; path: string } // serve this object path instead of the request path
  | { kind: "pass" }; // serve the request path as-is

/** Looks up a redirect target for an exact, trailing-slash-normalized key.
 *  A throw/rejection (store down) and a null/undefined/empty result both
 *  mean "no redirect here" to the caller. */
export type RedirectLookup = (key: string) => Promise<string | null | undefined> | string | null | undefined;

// Extensionless routes Next.js's static export emits for its file-convention
// metadata APIs (opengraph-image, twitter-image, icon, apple-icon). These are
// real objects, not directories, and must never be redirected or rewritten.
// Matched against the LAST path segment, not the exact path: Next emits these
// per-route (`/blog/opengraph-image`), and a root-only exact match would
// canonicalize the nested ones into the index rewrite and a 404.
export const STATIC_HOST_PASSTHROUGH: ReadonlySet<string> = new Set([
  "opengraph-image",
  "twitter-image",
  "icon",
  "apple-icon",
]);

/** A redirect target arrives from a store an operator with write access can
 *  edit directly. Refuse to serve a target that is protocol-relative
 *  ("//host" resolves off-site), uses backslash (URL parsers read "\" as "/"),
 *  or carries control characters (header injection). Falling through serves
 *  the request instead. */
export function isUnsafeRedirectTarget(target: string): boolean {
  if (target.charAt(0) === "/" && target.charAt(1) === "/") return true;
  if (target.indexOf("\\") !== -1) return true;
  for (let i = 0; i < target.length; i++) {
    const code = target.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function withQuery(location: string, query: string): string {
  if (!query) return location;
  return location + (location.includes("?") ? "&" : "?") + query;
}

/**
 * `path` is the request path exactly as received (CloudFront `uri` / URL
 * `pathname`, percent-encoded). `query` is the raw query string without a
 * leading "?", `""` when there is none, passed through verbatim: unlike the
 * CloudFront function, which rebuilds it from the runtime's parsed
 * querystring object, there is nothing to reassemble here.
 */
export async function resolveStaticHostRequest(
  path: string,
  query: string,
  lookup: RedirectLookup
): Promise<StaticHostDecision> {
  const key = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;

  // Any lookup failure degrades to "no redirect": losing redirects is an
  // inconvenience, losing the rewrite/canonicalization below is an outage.
  let target: string | null | undefined;
  try {
    target = await lookup(key);
  } catch {
    target = null;
  }
  if (target && !isUnsafeRedirectTarget(target)) {
    return { kind: "redirect", status: 301, location: withQuery(target, query) };
  }

  // The canonical form is the trailing slash (`trailingSlash: true`). The S3
  // (or equivalent object-store) origin has no index-document behaviour, so
  // this rewrite must run even when the redirect store is down.
  if (path.endsWith("/")) {
    return { kind: "rewrite", path: path + "index.html" };
  }

  // Bare page form (`/about`): 301 to the canonical slash form. Never emit a
  // path whose second character is another "/" as a Location: that resolves
  // as a protocol-relative URL, turning this canonicalization into an open
  // redirect, so such a path falls through to "pass" (and 404s at origin)
  // instead. Real extensionless objects (PASSTHROUGH, `/.well-known/…`) also
  // fall through untouched.
  const lastSegment = path.slice(path.lastIndexOf("/") + 1);
  if (
    path.charAt(1) !== "/" &&
    path.indexOf("/.well-known/") !== 0 &&
    !STATIC_HOST_PASSTHROUGH.has(lastSegment) &&
    lastSegment.indexOf(".") === -1
  ) {
    return { kind: "redirect", status: 301, location: withQuery(path + "/", query) };
  }

  return { kind: "pass" };
}
