import type { Catalog } from "./types";
import { UNSAFE_KEYS } from "./delta";

function sortedClone(node: string | Catalog): string | Catalog {
  if (typeof node === "string") {
    return node.normalize("NFC").replace(/\r\n?/g, "\n");
  }
  const sorted: Catalog = {};
  for (const key of Object.keys(node).sort()) {
    // Excluded from BOTH the hash and the serialized output, consistently:
    // assigning `sorted["__proto__"]` would walk the prototype setter and
    // silently drop the subtree from the serialization while the hash input
    // is built from the same clone. So the only safe, consistent treatment
    // is to skip unsafe keys entirely. See UNSAFE_KEYS in delta.ts.
    if (UNSAFE_KEYS.has(key)) continue;
    sorted[key] = sortedClone(node[key]!);
  }
  return sorted;
}

/**
 * Deterministic serialization shared by every producer/consumer of a catalog
 * hash (build, OTA, and any future edge/verify step). One canonicalizer,
 * not a re-implementation per runtime, or hash comparisons drift.
 */
export function canonicalize(catalog: Catalog): string {
  return JSON.stringify(sortedClone(catalog));
}

/**
 * Full sha256 hex of the canonical form. WebCrypto (`crypto.subtle`) so the
 * same code runs in Node >=18, browsers, and Bun with no `node:` import,
 * since this module sits on the OTA client path. Untruncated: these hashes are
 * content addresses baked into published URLs, and a truncation could never
 * be widened after publish.
 */
export async function hashCatalog(catalog: Catalog): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(catalog));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
