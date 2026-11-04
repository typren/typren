import { merge, UNSAFE_KEYS } from "./delta";
import { getClosestLocale, resolve } from "./locale";
import type { Catalog } from "./types";

export interface AliasEntry {
  to: string | null;
  since: string;
  removeAfter?: string;
}
export type AliasMap = Record<string, AliasEntry>;

export interface AliasResolverOptions {
  /** console.warn once per old key. Default: not production (process.env.NODE_ENV !== "production", read in try/catch; a missing `process` counts as dev). */
  warn?: boolean;
  /** Fired once per old key per resolver, in every mode. Errors it throws are swallowed. */
  onDeprecatedKey?: (oldKey: string, newKey: string | null) => void;
}

export interface AliasResolver {
  /** undefined: `key` is not aliased. null: decommissioned. string: the target key. The first lookup of each aliased key warns and/or fires the hook. */
  lookup(key: string): string | null | undefined;
}

export function isValidKeyPath(key: string): boolean {
  return key.split(".").every((seg) => seg !== "" && !UNSAFE_KEYS.has(seg));
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const FIELDS = new Set(["to", "since", "removeAfter"]);

export function parseAliases(raw: unknown, label = "_aliases.json"): AliasMap {
  const fail = (problems: string[]): never => {
    throw new Error(`${label}: ${problems.join("; ")}`);
  };
  if (!isPlainObject(raw)) return fail(["must be a JSON object"]);

  const problems: string[] = [];
  const entries: [string, AliasEntry][] = [];
  for (const [key, entry] of Object.entries(raw)) {
    const q = JSON.stringify(key);
    if (!isValidKeyPath(key)) {
      problems.push(`${q} is not a valid key path`);
      continue;
    }
    if (!isPlainObject(entry)) {
      problems.push(`${q} entry must be an object`);
      continue;
    }
    let ok = true;
    for (const f of Object.keys(entry)) {
      if (!FIELDS.has(f)) {
        problems.push(`${q} has unknown field ${JSON.stringify(f)}`);
        ok = false;
      }
    }
    const { to, since, removeAfter } = entry;
    if (!Object.hasOwn(entry, "to") || (to !== null && (typeof to !== "string" || !isValidKeyPath(to)))) {
      problems.push(`${q} needs "to" as null or a valid key path`);
      ok = false;
    } else if (to === key) {
      problems.push(`${q} aliases itself`);
      ok = false;
    }
    if (typeof since !== "string" || since === "") {
      problems.push(`${q} needs a non-empty "since"`);
      ok = false;
    }
    if (removeAfter !== undefined && (typeof removeAfter !== "string" || !isIsoDate(removeAfter))) {
      problems.push(`${q} "removeAfter" must be a YYYY-MM-DD date`);
      ok = false;
    }
    if (ok) {
      entries.push([
        key,
        {
          to: to as string | null,
          since: since as string,
          ...(removeAfter !== undefined && { removeAfter: removeAfter as string }),
        },
      ]);
    }
  }
  for (const [key, e] of entries) {
    if (typeof e.to === "string" && Object.hasOwn(raw, e.to)) {
      problems.push(`${JSON.stringify(key)} → ${JSON.stringify(e.to)} is a chain: ${JSON.stringify(e.to)} is itself an alias`);
    }
  }
  for (const [key] of entries) {
    const overlap = entries.find(([k]) => k.startsWith(`${key}.`));
    if (overlap) problems.push(`${JSON.stringify(key)} overlaps alias ${JSON.stringify(overlap[0])}`);
  }
  if (problems.length) fail(problems);
  return Object.fromEntries(entries);
}

function nodeAt(catalog: Catalog, path: string): string | Catalog | undefined {
  let node: string | Catalog = catalog;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || !Object.hasOwn(node, part)) return undefined;
    node = node[part]!;
  }
  return node;
}

export function validateAliases(
  aliases: AliasMap,
  catalogs: Record<string, Catalog>,
  defaultLocale?: string,
): string[] {
  const keys = Object.keys(aliases);
  if (keys.length === 0) return [];
  const locales = Object.keys(catalogs);
  if (locales.length === 0) return ["no locale catalogs to validate aliases against"];

  const def = defaultLocale ?? getClosestLocale([...locales].sort(), "en");
  const problems: string[] = [];
  const defCatalog = Object.hasOwn(catalogs, def) ? catalogs[def] : undefined;
  if (!defCatalog) problems.push(`default locale ${JSON.stringify(def)} has no catalog`);

  for (const old of keys.sort()) {
    const q = JSON.stringify(old);
    const { to } = aliases[old]!;
    if (typeof to === "string" && defCatalog && typeof nodeAt(defCatalog, to) !== "string") {
      problems.push(`${q} → ${JSON.stringify(to)}: target missing from default catalog ${JSON.stringify(def)}`);
    }
    const parts = old.split(".");
    for (const locale of locales) {
      const catalog = catalogs[locale]!;
      const l = JSON.stringify(locale);
      if (nodeAt(catalog, old) !== undefined) problems.push(`${q} is still present in ${l}`);
      for (let i = 1; i < parts.length; i++) {
        const prefix = parts.slice(0, i).join(".");
        if (typeof nodeAt(catalog, prefix) === "string") {
          problems.push(`${q} collides with leaf ${JSON.stringify(prefix)} in ${l}`);
        }
      }
    }
  }
  return problems;
}

export function applyAliasCopies(catalog: Catalog, aliases: AliasMap): Catalog {
  const changed: Record<string, string> = {};
  for (const [old, { to }] of Object.entries(aliases)) {
    const found = typeof to === "string" ? resolve(catalog, to) : undefined;
    if (found) changed[old] = found.value;
  }
  return merge(catalog, { changed, removed: [] });
}

function isProduction(): boolean {
  try {
    return process.env.NODE_ENV === "production";
  } catch {
    return false;
  }
}

export function createAliasResolver(aliases: AliasMap, opts: AliasResolverOptions = {}): AliasResolver {
  const map = parseAliases(aliases);
  const warn = opts.warn ?? !isProduction();
  const reported = new Set<string>();
  return {
    lookup(key) {
      if (!Object.hasOwn(map, key)) return undefined;
      const { to } = map[key]!;
      if (!reported.has(key)) {
        reported.add(key);
        if (warn) {
          console.warn(
            to === null
              ? `${JSON.stringify(key)} is decommissioned`
              : `${JSON.stringify(key)} is deprecated → use ${JSON.stringify(to)}`,
          );
        }
        try {
          opts.onDeprecatedKey?.(key, to);
        } catch {
          // a consumer hook must never break rendering
        }
      }
      return to;
    },
  };
}

export interface VueI18nMessagesLike {
  getLocaleMessage(locale: string): unknown;
  te?(key: string, locale?: string): boolean;
  t?(key: string, named: Record<string, unknown>, options: { locale: string }): string;
}
export type VueI18nMissingHandler = (locale: string, key: string, ...rest: unknown[]) => string | void;

export function createVueI18nMissingHandler(
  i18n: VueI18nMessagesLike,
  resolver: AliasResolver,
): VueI18nMissingHandler {
  return (locale, key) => {
    const target = resolver.lookup(key);
    if (typeof target !== "string") return undefined;
    const messages = i18n.getLocaleMessage(locale);
    if (typeof messages !== "object" || messages === null) return undefined;
    const found = resolve(messages as Catalog, target);
    if (found) return found.value;
    return i18n.t && i18n.te?.(target, locale) ? i18n.t(target, {}, { locale }) : undefined;
  };
}

export type I18nextParseMissingKeyHandler = (
  key: string,
  defaultValue?: string,
  options?: Record<string, unknown>,
) => string;

export function createI18nextParseMissingKeyHandler(
  translate: (key: string, options?: Record<string, unknown>) => string,
  resolver: AliasResolver,
): I18nextParseMissingKeyHandler {
  return (key, defaultValue, options) => {
    const target = resolver.lookup(key);
    return typeof target === "string" ? translate(target, options) : (defaultValue ?? key);
  };
}
