import type { RedirectEntry } from "@typren/core";
import type { KvsPair } from "./types";

// CloudFront KeyValueStore hard limits (not configurable, not a typren
// choice): https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_kvs_PutKeyRequestListItem.html
export const KVS_MAX_KEY_BYTES = 512;
export const KVS_MAX_VALUE_BYTES = 1024;

/**
 * Converts core's validated `RedirectEntry[]` into KVS-ready key/value pairs,
 * enforcing the store's own byte limits. This is where the CloudFront-specific
 * size check belongs (not in `@typren/core`'s `buildRedirects`, which only
 * knows about generic paths): a target-specific hard cap is the emitter's
 * concern, one vendor among several the core doesn't know about.
 */
export type ToKvsEntriesOptions = {
  /** Append the canonical trailing slash to on-site page targets (the
   *  `trailingSlash: true` static-export shape, and the default). A site
   *  whose canonical URLs are the bare form passes `false` and targets are
   *  emitted verbatim. */
  appendSlash?: boolean;
};

export function toKvsEntries(entries: RedirectEntry[], opts: ToKvsEntriesOptions = {}): KvsPair[] {
  const appendSlash = opts.appendSlash !== false;
  return entries.map(({ from, to, slug }) => {
    // Core normalizes `to` to the slashless form, but the trailing-slash
    // static-export shape's canonical page URLs all end in "/". Emitting the
    // slash form makes the edge redirect land directly on the canonical URL
    // in one 301, instead of a second bare-to-slash hop. Only on-site PAGE
    // paths get that treatment: an external URL from a map file is someone
    // else's canonical form and passes through verbatim, an on-site file
    // target (extension in the last segment) is an object, not a directory,
    // and a query/fragment rides along untouched.
    const value = appendSlash ? canonicalTarget(to) : to;
    // The key is stored the way the edge sees the URI: percent-encoded.
    // Stored verbatim, a `from` with a space or non-ASCII char could never
    // match a request and the redirect would silently do nothing. The byte
    // limit applies to what is actually stored, i.e. the encoded form.
    const key = encodeURI(from);
    if (Buffer.byteLength(key) > KVS_MAX_KEY_BYTES) {
      throw new Error(`typren: redirect "from" for "${slug}" exceeds the CloudFront KVS ${KVS_MAX_KEY_BYTES}-byte key limit: ${from}`);
    }
    if (Buffer.byteLength(value) > KVS_MAX_VALUE_BYTES) {
      throw new Error(`typren: redirect "to" for "${slug}" exceeds the CloudFront KVS ${KVS_MAX_VALUE_BYTES}-byte value limit (from ${from})`);
    }
    return { key, value };
  });
}

function canonicalTarget(to: string): string {
  if (!to.startsWith("/")) return to; // external URL, verbatim
  const cut = to.search(/[?#]/);
  const pathname = cut === -1 ? to : to.slice(0, cut);
  const rest = cut === -1 ? "" : to.slice(cut);
  if (pathname === "/" || pathname.endsWith("/")) return pathname + rest;
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (lastSegment.includes(".")) return pathname + rest; // a file object, not a page
  return `${pathname}/${rest}`;
}
