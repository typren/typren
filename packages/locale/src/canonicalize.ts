import { createHash } from "node:crypto";
import type { Catalog } from "./types";

function sortedClone(node: string | Catalog): string | Catalog {
  if (typeof node === "string") {
    return node.normalize("NFC").replace(/\r\n?/g, "\n");
  }
  const sorted: Catalog = {};
  for (const key of Object.keys(node).sort()) {
    sorted[key] = sortedClone(node[key]!);
  }
  return sorted;
}

/**
 * Deterministic serialization shared by every producer/consumer of a catalog
 * hash (build, OTA, and any future edge/verify step) — one canonicalizer,
 * not a re-implementation per runtime, or hash comparisons drift.
 */
export function canonicalize(catalog: Catalog): string {
  return JSON.stringify(sortedClone(catalog));
}

export function hashCatalog(catalog: Catalog): string {
  return createHash("sha256").update(canonicalize(catalog)).digest("hex").slice(0, 16);
}
