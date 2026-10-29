import type { Slice } from "./types";

/** Keys React or a component would turn into raw HTML. */
const HTML_KEY = /^(?:__html|dangerouslySetInnerHTML)$/i;
/** Prop names that usually end up in an href or src, by name or suffix
 *  (`href`, `ctaHref`, `image_url`, `link`, `srcSet`, ...). */
const URL_KEY = /(?:href|src|srcset|url|link|action|poster)$/i;
/** A scheme that runs script or carries a document. Browsers drop tabs,
 *  newlines and leading spaces or control characters before reading one. */
const UNSAFE_URL = /^(?:javascript|vbscript|data):/i;

/** Parse the `?slice=` query of a site's section canvas route into one Slice.
 *  The query is untrusted input that becomes component props, so this is the
 *  trust boundary: anything that is not a JSON object whose `slice` is a known
 *  registry key returns null, and it never throws. At any depth while
 *  parsing, `__proto__`, `__html` and `dangerouslySetInnerHTML` keys are
 *  dropped, and so is a string under a URL-like key (see `URL_KEY`) with a
 *  `javascript:`, `vbscript:` or `data:` scheme. Every other value passes
 *  as it came: a component that renders a string prop as HTML still renders
 *  whatever a link to this route puts there. `known` is the registry's keys,
 *  or a predicate over a key. */
export function parseSectionQuery(
  raw: string | null | undefined,
  known: readonly string[] | ((key: string) => boolean),
): Slice | null {
  return toSlice(parse(raw), known);
}

/** The section canvas's many-slice query, `?slices=`: a JSON object of
 *  opaque keys to slices, each checked exactly as `parseSectionQuery` checks
 *  one. Entries that fail are left out; anything else returns `{}`. */
export function parseSectionMap(
  raw: string | null | undefined,
  known: readonly string[] | ((key: string) => boolean),
): Record<string, Slice> {
  const value = parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, Slice> = {};
  for (const [key, entry] of Object.entries(value)) {
    const slice = toSlice(entry, known);
    if (slice) out[key] = slice;
  }
  return out;
}

/** Whether the value under key `k` is dropped: the one rule both the query
 *  parser and the posted-document check apply. */
const dropped = (k: string, v: unknown) =>
  k === "__proto__" ||
  HTML_KEY.test(k) ||
  // eslint-disable-next-line no-control-regex -- the control characters are the point.
  (typeof v === "string" && URL_KEY.test(k) && UNSAFE_URL.test(v.replace(/[\u0000-\u0020]/g, "")));

function parse(raw: string | null | undefined): unknown {
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw, (k, v: unknown) => (dropped(k, v) ? undefined : v));
  } catch {
    return undefined;
  }
}

/** Caps on a posted page document (see `parseSectionDocument`). */
export const DOCUMENT_LIMITS = { slices: 500, depth: 32, size: 4_000_000 } as const;

/** One slice of a posted page document: the studio's per-session key, and
 *  the slice, or null when it is not one this site can render. */
export type KeyedSlice = { key: string; slice: Slice | null };

/** A cleaned copy of a structured-clone value, or `TOO_BIG` once `budget`
 *  (string characters plus one per value) or the depth cap runs out. Only
 *  JSON's shapes survive; anything else a structured clone can carry (a Map,
 *  a Date, a Blob) is dropped. */
const TOO_BIG = Symbol("too big");
function clean(v: unknown, depth: number, budget: { left: number }): unknown {
  budget.left -= typeof v === "string" ? v.length + 1 : 1;
  if (budget.left < 0 || depth > DOCUMENT_LIMITS.depth) return TOO_BIG;
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (const item of v) {
      const c = clean(item, depth + 1, budget);
      if (c === TOO_BIG) return TOO_BIG;
      out.push(c ?? null);
    }
    return out;
  }
  if (typeof v !== "object" || Object.getPrototypeOf(v) !== Object.prototype) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, item] of Object.entries(v)) {
    if (dropped(k, item)) continue;
    const c = clean(item, depth + 1, budget);
    if (c === TOO_BIG) return TOO_BIG;
    if (c !== undefined) out[k] = c;
  }
  return out;
}

/** The section canvas's page document, as the studio posts it: up to 500
 *  `{ key, slice }` entries. Posted values arrive by structured clone, not
 *  JSON, so each slice is copied through the same rules `parseSectionQuery`
 *  applies (known registry key, no `__proto__` or raw-HTML keys, no script
 *  URLs under link-like keys), keeping JSON's shapes only, within
 *  `DOCUMENT_LIMITS` depth and total size. A slice that fails comes back as
 *  null under its key, for the canvas to report missing; a malformed or
 *  oversized document, or duplicate or bad keys, returns null. */
export function parseSectionDocument(
  raw: unknown,
  known: readonly string[] | ((key: string) => boolean),
): KeyedSlice[] | null {
  if (!Array.isArray(raw) || raw.length > DOCUMENT_LIMITS.slices) return null;
  const budget = { left: DOCUMENT_LIMITS.size };
  const keys = new Set<string>();
  const out: KeyedSlice[] = [];
  for (const entry of raw) {
    const key = entry?.key;
    if (typeof key !== "string" || !key || key.length > 64 || keys.has(key)) return null;
    keys.add(key);
    const slice = sanitizeSlice(entry.slice, known, budget);
    if (slice === TOO_BIG) return null;
    out.push({ key, slice });
  }
  return out;
}

function sanitizeSlice(
  raw: unknown,
  known: readonly string[] | ((key: string) => boolean),
  budget: { left: number },
): Slice | null | typeof TOO_BIG {
  const value = clean(raw, 0, budget);
  return value === TOO_BIG ? TOO_BIG : toSlice(value, known);
}

function toSlice(value: unknown, known: readonly string[] | ((key: string) => boolean)): Slice | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { slice } = value as { slice?: unknown };
  if (typeof slice !== "string") return null;
  if (!(typeof known === "function" ? known(slice) : known.includes(slice))) return null;
  return value as Slice;
}
