import { toRedirectPairs, type RedirectEntry } from "@typren/core";
import type { KvsPair } from "./types";

// CloudFront KeyValueStore hard limits (not configurable, not a typren
// choice): https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_kvs_PutKeyRequestListItem.html
export const KVS_MAX_KEY_BYTES = 512;
export const KVS_MAX_VALUE_BYTES = 1024;

export type ToKvsEntriesOptions = {
  /** Append the canonical trailing slash to on-site page targets (the
   *  `trailingSlash: true` static-export shape, and the default). A site
   *  whose canonical URLs are the bare form passes `false` and targets are
   *  emitted verbatim. */
  appendSlash?: boolean;
};

/**
 * Thin wrapper around `@typren/core`'s `toRedirectPairs`, adding the one
 * thing that's actually CloudFront-specific: the KeyValueStore's own byte
 * limits. A target-specific hard cap is the emitter's concern, one vendor
 * among several core doesn't know about, so it does not belong in the
 * host-agnostic pair-building logic itself.
 */
export function toKvsEntries(entries: RedirectEntry[], opts: ToKvsEntriesOptions = {}): KvsPair[] {
  const pairs = toRedirectPairs(entries, opts);
  return entries.map(({ from, slug }, i) => {
    const { key, value } = pairs[i];
    // The byte limit applies to what is actually stored: the key is already
    // percent-encoded (the form the edge sees the URI in), so a `from` with
    // a space or non-ASCII char is checked at the size it's stored at, not
    // its shorter source form.
    if (Buffer.byteLength(key) > KVS_MAX_KEY_BYTES) {
      throw new Error(`typren: redirect "from" for "${slug}" exceeds the CloudFront KVS ${KVS_MAX_KEY_BYTES}-byte key limit: ${from}`);
    }
    if (Buffer.byteLength(value) > KVS_MAX_VALUE_BYTES) {
      throw new Error(`typren: redirect "to" for "${slug}" exceeds the CloudFront KVS ${KVS_MAX_VALUE_BYTES}-byte value limit (from ${from})`);
    }
    return { key, value };
  });
}
