import type { Catalog } from "../types";
import type { ExportApiSourceConfig } from "./export-api";

/**
 * A pluggable ingest source. This is the port: implement it once per
 * producer (fs directory, Lokalise, any TMS with a bundle-export API, ...)
 * and `buildCatalogs` doesn't care which one it's talking to.
 *
 * `loadSource` returns parsed catalogs keyed by the canonical locale (BCP-47,
 * "-"-separated), with this provider's locale-key normalization already
 * applied (e.g. "en_US" -> "en-US"). The package owns the output shape:
 * producer quirks are config (`langMap`, a filename style), never
 * byte-mirrored. A provider that also needs producer-shaped files back
 * (a compat export, a debug dump, ...) derives them FROM these catalogs with
 * `writeLocaleFiles`, not the other way around.
 */
export interface LocaleSourceProvider {
  /** Short identifier for error messages / config validation (e.g. "files", "lokalise"). */
  readonly type: string;
  loadSource(): Promise<Record<string, Catalog>>;
}

/** Config for the reference fs provider: a directory of one `<locale>.json` per locale. */
export interface FilesSourceConfig {
  type: "files";
  /** Directory containing one `<locale>.json` per locale. */
  dir: string;
  /**
   * Producer-name -> canonical-locale-key overrides for `loadSource` (e.g.
   * `{ en_US: "en-custom" }`). Anything not listed falls back to the default
   * "_" -> "-" mapping.
   */
  langMap?: Record<string, string>;
}

/**
 * Discriminated union of every source's config shape: "files" (see
 * fs-provider.ts) plus "export-api", the generic TMS bundle-export source
 * (see export-api.ts, config'd per-TMS via presets.ts). A further provider is
 * a config shape added here and a case in resolve-provider.ts to slot it in
 * as a sibling.
 */
export type SourceConfig = FilesSourceConfig | ExportApiSourceConfig;

/** Default locale-key normalization: producer's raw name -> canonical key. */
export function normalizeLocaleKey(name: string, langMap?: Record<string, string>): string {
  return langMap?.[name] ?? name.replace(/_/g, "-");
}
