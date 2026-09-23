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
export function toKvsEntries(entries: RedirectEntry[]): KvsPair[] {
  return entries.map(({ from, to, slug }) => {
    // Core normalizes `to` to the slashless form, but this target serves a
    // `trailingSlash: true` static export whose canonical page URLs all end in
    // "/". Emitting the slash form makes the edge redirect land directly on
    // the canonical URL in one 301, instead of a second bare-to-slash hop.
    // Only on-site PAGE paths get that treatment: an external URL from a map
    // file is someone else's canonical form and passes through verbatim, and
    // an on-site file target (extension in the last segment) is an object,
    // not a directory.
    const value = canonicalTarget(to);
    if (Buffer.byteLength(from) > KVS_MAX_KEY_BYTES) {
      throw new Error(`typren: redirect "from" for "${slug}" exceeds the CloudFront KVS ${KVS_MAX_KEY_BYTES}-byte key limit: ${from}`);
    }
    if (Buffer.byteLength(value) > KVS_MAX_VALUE_BYTES) {
      throw new Error(`typren: redirect "to" for "${slug}" exceeds the CloudFront KVS ${KVS_MAX_VALUE_BYTES}-byte value limit (from ${from})`);
    }
    return { key: from, value };
  });
}

function canonicalTarget(to: string): string {
  if (!to.startsWith("/")) return to; // external URL, verbatim
  if (to === "/" || to.endsWith("/")) return to;
  const lastSegment = to.slice(to.lastIndexOf("/") + 1);
  if (lastSegment.includes(".")) return to; // a file object, not a page
  return `${to}/`;
}
