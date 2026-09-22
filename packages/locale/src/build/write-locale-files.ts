import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalize } from "../canonicalize";
import type { Catalog } from "../types";

/**
 * How the canonical locale key (e.g. "en-US") maps to an on-disk filename.
 * "dash" (default) uses the key verbatim; "underscore" swaps "-" for "_";
 * a function gets the key and returns the full filename for full control.
 */
export type FilenameStyle = "dash" | "underscore" | ((locale: string) => string);

export interface WriteLocaleFilesOptions {
  filenameStyle?: FilenameStyle;
}

function toFilename(locale: string, style: FilenameStyle): string {
  if (typeof style === "function") return style(locale);
  if (style === "underscore") return `${locale.replace(/-/g, "_")}.json`;
  return `${locale}.json`;
}

/**
 * Pretty-printed, human-reviewable rendering of the same canonical bytes
 * `hashCatalog` covers: same sorted keys and NFC-normalized strings as
 * `canonicalize`, just reformatted with 2-space indent and a trailing
 * newline instead of the compact hash input.
 */
function serialize(catalog: Catalog): string {
  return `${JSON.stringify(JSON.parse(canonicalize(catalog)), null, 2)}\n`;
}

/**
 * Writes one `<locale>.json` file per catalog, derived FROM the catalogs
 * rather than the other way around. This is the inverse of a source
 * provider's `loadSource`: the future CLI `pull` verb calls it to
 * materialize a snapshot that a human, or a `files` provider, can read
 * back. Filenames come from applying `filenameStyle` to each canonical
 * locale key; content is deterministic, so a rerun over unchanged catalogs
 * produces byte-identical files.
 */
export function writeLocaleFiles(
  catalogs: Record<string, Catalog>,
  dir: string,
  opts: WriteLocaleFilesOptions = {},
): Record<string, string> {
  const style = opts.filenameStyle ?? "dash";
  mkdirSync(dir, { recursive: true });

  const paths: Record<string, string> = {};
  for (const [locale, catalog] of Object.entries(catalogs)) {
    const path = join(dir, toFilename(locale, style));
    writeFileSync(path, serialize(catalog));
    paths[locale] = path;
  }
  return paths;
}
