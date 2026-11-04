import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { createFsSourceProvider, normalizeLocaleKey, resolveProvider } from "../build";
import { flatten } from "../delta";
import type { Catalog } from "../types";
import { readConfigFile } from "./config-file";

export type FlatCatalog = Record<string, string>;

export interface CatalogInput {
  /** A dir of <locale>.json files, or one <locale>.json file. */
  locales?: string;
  /** A { app, source, defaultLocale? } build config; its source is used when `locales` is absent. */
  config?: string;
  defaultLocale?: string;
}

export interface LoadedCatalogs {
  defaultLocale: string;
  /** defaultLocale first, then the rest sorted. */
  locales: string[];
  catalogs: Record<string, FlatCatalog>;
}

function checkLeaves(locale: string, node: unknown, path: string): void {
  for (const [key, value] of Object.entries(node as object)) {
    const here = path ? `${path}.${key}` : key;
    if (typeof value === "string") continue;
    if (value !== null && typeof value === "object") {
      checkLeaves(locale, value, here);
      continue;
    }
    const kind = value === null ? "null" : typeof value;
    throw new Error(`${locale}: value at "${here}" is ${kind}; expected a string or nested object`);
  }
}

async function loadRaw(locales: string): Promise<Record<string, Catalog>> {
  let isFile: boolean;
  try {
    isFile = statSync(locales).isFile();
  } catch {
    throw new Error(`--locales not found: ${locales}`);
  }
  if (!isFile) return createFsSourceProvider(locales).loadSource();
  return { [normalizeLocaleKey(basename(locales, ".json"))]: JSON.parse(readFileSync(locales, "utf8")) };
}

export async function loadCatalogs(input: CatalogInput): Promise<LoadedCatalogs> {
  if (!input.locales && !input.config) throw new Error("pass --locales <dir|file> or --config <path>");

  let raw: Record<string, Catalog>;
  let configDefault: string | undefined;
  let source: string;

  if (input.config) {
    const loaded = readConfigFile(input.config);
    if (!loaded.ok) throw new Error(loaded.error);
    const declared: unknown = loaded.raw.defaultLocale;
    if (declared !== undefined && typeof declared !== "string") {
      throw new Error(`defaultLocale in ${input.config} must be a string`);
    }
    configDefault = declared;
    // resolve() only when the config's source is actually used, so --locales works without the config's env vars set.
    raw = input.locales ? await loadRaw(input.locales) : await resolveProvider(loaded.resolve().source).loadSource();
    source = input.locales ?? input.config;
  } else {
    raw = await loadRaw(input.locales!);
    source = input.locales!;
  }

  const catalogs: Record<string, FlatCatalog> = {};
  for (const [locale, catalog] of Object.entries(raw)) {
    checkLeaves(locale, catalog, "");
    catalogs[locale] = flatten(catalog);
  }
  const found = Object.keys(catalogs);
  if (found.length === 0) throw new Error(`no <locale>.json catalogs found in ${source}`);

  const chosen = input.defaultLocale ?? configDefault;
  let defaultLocale: string;
  if (chosen !== undefined) defaultLocale = normalizeLocaleKey(chosen);
  else if (found.length === 1) defaultLocale = found[0]!;
  else {
    throw new Error(`cannot tell the default locale: pass --default-locale <id> (found: ${found.sort().join(", ")})`);
  }
  if (!(defaultLocale in catalogs)) {
    throw new Error(`default locale "${defaultLocale}" has no catalog (found: ${found.sort().join(", ")})`);
  }

  const locales = [defaultLocale, ...found.filter((l) => l !== defaultLocale).sort()];
  return { defaultLocale, locales, catalogs };
}
