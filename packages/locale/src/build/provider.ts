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

// BCP-47-ish: a 2-3 letter language plus optional subtags. The canonical key becomes a path segment
// (`catalog/<app>/<lang>/`, `<lang>.json`), so anything looser lets a bundle entry like `../package`
// write outside the output directory.
const LOCALE_KEY = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * Default locale-key normalization: producer's raw name -> canonical key. "_" variants normalize to
 * "-" first (so `en_US` stays valid); the result, `langMap` overrides included, must be BCP-47-ish
 * or this throws naming the key.
 */
export function normalizeLocaleKey(name: string, langMap?: Record<string, string>): string {
  const key = langMap?.[name] ?? name.replace(/_/g, "-");
  if (!LOCALE_KEY.test(key)) {
    throw new Error(`normalizeLocaleKey: unsafe locale key "${key}" (from "${name}"); expected a BCP-47 tag like "en-US"`);
  }
  return key;
}
