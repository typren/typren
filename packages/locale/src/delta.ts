import type { Catalog, Delta } from "./types";

/**
 * Keys that collide with `Object.prototype` machinery. A remote catalog is
 * attacker-adjacent input (CDN compromise, MITM on a misconfigured origin),
 * so any of these appearing as an object key or a dot-path segment is
 * dropped everywhere: flatten, setPath, deletePath, and canonicalize.
 * Otherwise `obj["__proto__"] = {...}` walks the prototype setter and
 * pollutes every object in the realm.
 */
export const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

function flatten(catalog: Catalog, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(catalog)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out[path] = value;
    } else {
      Object.assign(out, flatten(value, path));
    }
  }
  return out;
}

/** Flat dot-path diff between two catalogs. */
export function diff(from: Catalog, to: Catalog): Delta {
  const fromFlat = flatten(from);
  const toFlat = flatten(to);

  const changed: Record<string, string> = {};
  for (const [key, value] of Object.entries(toFlat)) {
    if (fromFlat[key] !== value) changed[key] = value;
  }

  const removed = Object.keys(fromFlat).filter((key) => !Object.hasOwn(toFlat, key));

  return { changed, removed };
}

// Literal comparisons (not a Set lookup) so static analysis can prove the
// prototype-pollution sanitizer; UNSAFE_KEYS stays the canonical list for
// callers that only read.
function isUnsafeSegment(part: string): boolean {
  return part === "__proto__" || part === "constructor" || part === "prototype";
}

function setPath(obj: Catalog, path: string, value: string): void {
  const parts = path.split(".");
  if (parts.some(isUnsafeSegment)) return;
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (isUnsafeSegment(part)) return;
    const next = node[part];
    if (typeof next !== "object" || next === null) node[part] = {};
    node = node[part] as Catalog;
  }
  const leaf = parts[parts.length - 1]!;
  if (isUnsafeSegment(leaf)) return;
  node[leaf] = value;
}

function deletePath(obj: Catalog, path: string): void {
  const parts = path.split(".");
  if (parts.some(isUnsafeSegment)) return;
  let node: Catalog = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (isUnsafeSegment(part)) return;
    const next = node[part];
    if (typeof next !== "object" || next === null) return;
    node = next;
  }
  const leaf = parts[parts.length - 1]!;
  if (isUnsafeSegment(leaf)) return;
  delete node[leaf];
}

/**
 * Apply a delta onto a baked catalog. Returns a NEW object (never mutates
 * `baked`) so a caller holding a reference to the old catalog can detect
 * the swap and re-render.
 *
 * `removed` is applied ONLY when `opts.allowRemove` is true (default
 * false): a delta landing on an OLD build must never remove keys. The old
 * build's code still calls them, and a rename would render the raw key
 * literal. Removal only takes effect at the next bake.
 */
export function merge(baked: Catalog, delta: Delta, opts?: { allowRemove?: boolean }): Catalog {
  const result = structuredClone(baked);
  for (const [key, value] of Object.entries(delta.changed)) {
    setPath(result, key, value);
  }
  if (opts?.allowRemove) {
    for (const key of delta.removed) deletePath(result, key);
  }
  return result;
}

const VAR_NAME = /\{(\w+)\}/g;

function varsOf(value: string): Set<string> {
  return new Set([...value.matchAll(VAR_NAME)].map((m) => m[1]!));
}

/**
 * Publish-time compatibility check: a changed string may only ship as a
 * delta to older builds if it uses exactly the same `{var}` set as the
 * string it replaces. Otherwise the caller must version-pin instead of
 * shipping the delta to old builds (e.g. "Hello {name}" -> "{count} left").
 */
export function isPlaceholderCompatible(fromVal: string, toVal: string): boolean {
  const from = varsOf(fromVal);
  const to = varsOf(toVal);
  if (from.size !== to.size) return false;
  for (const name of from) if (!to.has(name)) return false;
  return true;
}
