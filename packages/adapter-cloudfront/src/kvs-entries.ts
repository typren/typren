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
    if (Buffer.byteLength(from) > KVS_MAX_KEY_BYTES) {
      throw new Error(`typren: redirect "from" for "${slug}" exceeds the CloudFront KVS ${KVS_MAX_KEY_BYTES}-byte key limit: ${from}`);
    }
    if (Buffer.byteLength(to) > KVS_MAX_VALUE_BYTES) {
      throw new Error(`typren: redirect "to" for "${slug}" exceeds the CloudFront KVS ${KVS_MAX_VALUE_BYTES}-byte value limit (from ${from})`);
    }
    return { key: from, value: to };
  });
}
