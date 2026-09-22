import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Catalog } from "../types";
import type { LocaleSourceProvider } from "./provider";
import { normalizeLocaleKey } from "./provider";

function listJsonFiles(dir: string): string[] {
  return readdirSync(dir).filter((file) => extname(file) === ".json");
}

/**
 * Reference LocaleSourceProvider: a directory of one `<locale>.json` per
 * locale. `loadSource` derives each catalog's canonical locale key from the
 * file's basename via `normalizeLocaleKey` (default "_" -> "-", or
 * `langMap` where given).
 */
export function createFsSourceProvider(dir: string, langMap?: Record<string, string>): LocaleSourceProvider {
  return {
    type: "files",

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
