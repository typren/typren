import { toRedirectPairs, type RedirectEntry } from "@typren/core";

// Workers KV key limit (not configurable, not a typren choice), measured on
// the encoded form: https://developers.cloudflare.com/kv/platform/limits/
// The 25 MiB value limit isn't checked: a redirect target is never remotely
// close to it.
export const KV_MAX_KEY_BYTES = 512;

export type ToKvEntriesOptions = {
  /** Append the canonical trailing slash to on-site page targets (the
   *  `trailingSlash: true` static-export shape, and the default). A site
   *  whose canonical URLs are the bare form passes `false` and targets are
   *  emitted verbatim. */
  appendSlash?: boolean;
};

/**
 * Thin wrapper around `@typren/core`'s `toRedirectPairs`, adding the one
 * thing that's actually Cloudflare-specific: the KV key's own byte limit.
 * A target-specific hard cap is the emitter's concern, one vendor among
 * several core doesn't know about, so it does not belong in the
 * host-agnostic pair-building logic itself (mirrors
 * `@typren/adapter-cloudfront`'s `toKvsEntries`).
 */
export function toKvEntries(entries: RedirectEntry[], opts: ToKvEntriesOptions = {}): { key: string; value: string }[] {
  const pairs = toRedirectPairs(entries, opts);
  return entries.map(({ from, slug }, i) => {
    const { key, value } = pairs[i];
    // The limit applies to what is actually stored: the key is already
    // percent-encoded (the form a request path arrives in), so a `from` with
    // a space or non-ASCII char is checked at the size it's stored at, not
    // its shorter source form.
    if (Buffer.byteLength(key) > KV_MAX_KEY_BYTES) {
      throw new Error(`typren: redirect "from" for "${slug}" exceeds the Workers KV ${KV_MAX_KEY_BYTES}-byte key limit: ${from}`);
    }
    return { key, value };
  });
}
