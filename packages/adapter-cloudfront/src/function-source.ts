import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// A segment is templated into the published function's JS source as an
// object key (see EXTRA_PASSTHROUGH_PLACEHOLDER below), so this is the
// injection boundary: only bare path-segment characters are accepted here,
// and the accepted value is still JSON.stringify'd rather than
// string-concatenated before replacing the placeholder.
const SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

// Must match the exact placeholder string literal in both
// redirects.function.js and redirects-bare-url.function.js.
const EXTRA_PASSTHROUGH_PLACEHOLDER = '"__TYPREN_EXTRA_PASSTHROUGH__"';

export type FunctionSourceOptions = {
  /** The export's URL shape (mirrors sync's own `--trailing-slash`): `true`
   *  (default) reads the trailing-slash/directory-index function
   *  (redirects.function.js), `false` reads the bare-URL function
   *  (redirects-bare-url.function.js). */
  trailingSlash?: boolean;
  /** Extra path-convention segments (beyond the built-in Next metadata names
   *  and `/.well-known/`) that are real extensionless objects at this site,
   *  never redirected or rewritten by the bare-form canonicalization. Each
   *  must be a bare path segment: letters, digits, "-", "_" only, no "/",
   *  ".", or other characters; see SEGMENT_PATTERN. */
  extraPassthroughSegments?: string[];
};

function sourceFileName(trailingSlash: boolean): string {
  return trailingSlash ? "redirects.function.js" : "redirects-bare-url.function.js";
}

/** The canonical viewer-request function's source, selected by URL shape and
 *  templated with this site's extra passthrough segments, read fresh off
 *  disk so `bootstrap`/tests always see whatever this installed package
 *  version carries, never a stale copy baked in at some other build step.
 *  Resolved via `node:url`'s own fileURLToPath (not a bare `new URL(...)`,
 *  which a jsdom test environment's polyfilled global URL mishandles for the
 *  `file:` scheme readFileSync needs). */
export function readFunctionSource(opts: FunctionSourceOptions = {}): string {
  const file = sourceFileName(opts.trailingSlash !== false);
  const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), file), "utf8");

  const segments = opts.extraPassthroughSegments ?? [];
  for (const segment of segments) {
    if (!SEGMENT_PATTERN.test(segment)) {
      throw new Error(
        `typren-cloudfront: invalid --extra-passthrough segment ${JSON.stringify(segment)} (letters, digits, "-", "_" only)`
      );
    }
  }
  if (!source.includes(EXTRA_PASSTHROUGH_PLACEHOLDER)) {
    // Should be unreachable (both committed function files carry the
    // placeholder), but a future edit to either file that drops it must fail
    // loud rather than silently publish a function that ignores the flag.
    throw new Error(`typren-cloudfront: ${file} is missing its passthrough template placeholder`);
  }

  const extraPassthrough: Record<string, true> = {};
  for (const segment of segments) extraPassthrough[segment] = true;

  // JSON.stringify, never string concatenation: this string is spliced
  // directly into the JS source that gets published and executed at the
  // edge, so an operator-supplied segment must never be able to break out of
  // this object literal into surrounding code (it's already rejected above
  // if it's not a bare segment; this is the actual injection boundary that
  // guard protects).
  return source.replace(EXTRA_PASSTHROUGH_PLACEHOLDER, JSON.stringify(extraPassthrough));
}
