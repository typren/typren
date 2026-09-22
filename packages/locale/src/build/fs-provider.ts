import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Catalog } from "../types";
import type { LocaleSourceProvider, RawEntries } from "./provider";
import { normalizeLocaleKey } from "./provider";

function listJsonFiles(dir: string): string[] {
  return readdirSync(dir).filter((file) => extname(file) === ".json");
}

/**
 * Reference LocaleSourceProvider: a directory of one `<locale>.json` per
 * locale. Proves the port's raw/normalized split even without a real HTTP
 * source: `loadRawEntries` never touches a filename, `loadSource` applies
 * `langMap` (default "_" -> "-") to the catalog key only.
 */
export function createFsSourceProvider(dir: string, langMap?: Record<string, string>): LocaleSourceProvider {
  return {
    type: "files",

    async loadRawEntries(): Promise<RawEntries> {
      const entries: RawEntries = {};
      for (const file of listJsonFiles(dir)) entries[file] = readFileSync(join(dir, file));
      return entries;
    },

    async loadSource(): Promise<Record<string, Catalog>> {
      const catalogs: Record<string, Catalog> = {};
      for (const file of listJsonFiles(dir)) {
        const locale = normalizeLocaleKey(basename(file, ".json"), langMap);
        catalogs[locale] = JSON.parse(readFileSync(join(dir, file), "utf8"));
      }
      return catalogs;
    },
  };
}
