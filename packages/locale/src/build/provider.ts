import type { Catalog } from "../types";

/** Raw bundle/dir entries keyed by the producer's exact on-disk filename (e.g. "en_US.json") -> exact bytes. */
export type RawEntries = Record<string, Uint8Array>;

/**
 * A pluggable ingest source. This is the port: implement it once per
 * producer (fs directory, Lokalise, any TMS with a bundle-export API, ...)
 * and `buildCatalogs` doesn't care which one it's talking to.
 *
 * Two methods, two concerns. Never conflate them:
 *
 * - `loadRawEntries` is the byte-identical drop-in path: exact bytes, keyed
 *   by the producer's ORIGINAL filename verbatim (e.g. "en_US.json", underscore
 *   intact). No parsing, no locale-key normalization. This is what a
 *   `file download`-style compat command re-emits unchanged.
 * - `loadSource` is the catalog path: parsed JSON keyed by the INTERNAL
 *   locale key, with this provider's locale-key normalization applied (e.g.
 *   "en_US" -> "en-US"). This is what `buildCatalogs` reads.
 *
 * A provider must never let normalization leak into `loadRawEntries`' keys,
 * and must never skip it in `loadSource`'s keys. The split is the contract.
 */
export interface LocaleSourceProvider {
  /** Short identifier for error messages / config validation (e.g. "files", "lokalise"). */
  readonly type: string;
  loadRawEntries(): Promise<RawEntries>;
  loadSource(): Promise<Record<string, Catalog>>;
}

/** Config for the reference fs provider: a directory of one `<locale>.json` per locale. */
export interface FilesSourceConfig {
  type: "files";
  /** Directory containing one `<locale>.json` per locale. */
  dir: string;
  /**
   * Producer-name -> internal-locale-key overrides for `loadSource` only
   * (e.g. `{ en_US: "en-custom" }`). Anything not listed falls back to the
   * default "_" -> "-" mapping. Never affects `loadRawEntries`.
   */
  langMap?: Record<string, string>;
}

/**
 * Discriminated union of every source's config shape. Only "files" ships in
 * this port (see fs-provider.ts); further providers ("lokalise", a generic
 * export-API source, ...) are follow-up work: add each one's config shape
 * here and a case in resolve-provider.ts to slot it in as a sibling.
 */
export type SourceConfig = FilesSourceConfig;

/** Default locale-key normalization: producer's raw name -> internal key. */
export function normalizeLocaleKey(name: string, langMap?: Record<string, string>): string {
  return langMap?.[name] ?? name.replace(/_/g, "-");
}
