import { existsSync, globSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type { AliasMap } from "../aliases";
import { ALIASES_FILE, aliasesPathFor, readAliasesFile } from "../build/aliases-file";
import { loadCatalogs } from "./catalogs";
import { readConfigFile } from "./config-file";
import { parseStrictArgs, type FlagSpec } from "./args";
import { EXIT_OK, EXIT_PROBLEMS, errorMessage, fail, printJson } from "./output";
import { USAGE_PRESET_NAMES, compileKeyPattern, findKeyRefs, type KeyRef, type UsagePresetName } from "./usage-presets";
import { pluralFamily } from "./formats";

export const SCAN_FLAGS: FlagSpec = {
  strings: ["locales", "config", "default-locale", "aliases"],
  lists: ["preset", "key-pattern"],
  booleans: ["allow-unused"],
};

export interface ScanOptions {
  /** Directories, files or globs. */
  sources: string[];
  locales?: string;
  config?: string;
  defaultLocale?: string;
  /** Default: every preset. */
  presets?: UsagePresetName[];
  /** Raw --key-pattern strings. */
  keyPatterns?: string[];
  allowUnused?: boolean;
  /** Alias file; default: `_aliases.json` next to the catalogs. */
  aliases?: string;
  /** Today, for the removeAfter comparison. Default: the current time. */
  now?: Date;
}

export interface DeprecatedRef {
  /** The alias old key. */
  key: string;
  /** Its replacement; null when decommissioned. */
  to: string | null;
  removeAfter?: string;
  /** removeAfter has passed: an error, not a warning. */
  expired: boolean;
  refs: { file: string; line: number }[];
}

export interface ScanResult {
  /** No unused keys (or --allow-unused) and no deprecated key past its removeAfter. */
  ok: boolean;
  defaultLocale: string;
  /** Source files scanned. */
  files: number;
  /** Catalog keys referenced statically, sorted. */
  used: string[];
  /** Keys covered only by a runtime-built prefix, sorted by key. */
  dynamic: { key: string; prefix: string }[];
  unused: string[];
  /** Alias old keys still referenced in source, sorted by key. */
  deprecated: DeprecatedRef[];
}

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".vue", ".svelte", ".html"]);
const SKIPPED = new Set(["node_modules", "dist", ".git"]);
const GLOB_CHARS = /[*?[{]/;

const isSource = (path: string) =>
  SOURCE_EXTENSIONS.has(extname(path)) && !path.split(/[\\/]/).some((segment) => SKIPPED.has(segment));

export function collectSourceFiles(inputs: readonly string[]): string[] {
  const files = new Set<string>();
  for (const input of inputs) {
    if (existsSync(input)) {
      if (statSync(input).isDirectory()) {
        for (const rel of readdirSync(input, { recursive: true, encoding: "utf8" })) {
          const full = join(input, rel);
          if (isSource(rel) && statSync(full).isFile()) files.add(full);
        }
      } else files.add(input);
    } else if (GLOB_CHARS.test(input)) {
      for (const match of globSync(input)) if (isSource(match) && statSync(match).isFile()) files.add(match);
    } else {
      throw new Error(`source not found: ${input}`);
    }
  }
  if (files.size === 0) throw new Error(`no source files matched: ${inputs.join(" ")}`);
  return [...files].sort();
}

export function classifyKeys(
  keys: readonly string[],
  refs: readonly KeyRef[],
  opts: { pluralSuffixes: boolean },
): Pick<ScanResult, "used" | "dynamic" | "unused"> {
  const statics = new Set(refs.filter((r) => !r.dynamic).map((r) => r.key));
  const prefixes = [...new Set(refs.filter((r) => r.dynamic).map((r) => r.key))];
  const used: string[] = [];
  const dynamic: { key: string; prefix: string }[] = [];
  const unused: string[] = [];
  for (const key of keys) {
    if (statics.has(key) || (opts.pluralSuffixes && statics.has(pluralFamily(key)?.base ?? ""))) {
      used.push(key);
      continue;
    }
    const prefix = prefixes.filter((p) => key.startsWith(p)).sort((a, b) => b.length - a.length)[0];
    if (prefix !== undefined) dynamic.push({ key, prefix });
    else unused.push(key);
  }
  return { used: used.sort(), dynamic: dynamic.sort((a, b) => a.key.localeCompare(b.key)), unused: unused.sort() };
}

async function loadAliases(opts: ScanOptions): Promise<AliasMap> {
  let path = opts.aliases;
  if (!path && opts.locales) path = join(statSync(opts.locales).isDirectory() ? opts.locales : dirname(opts.locales), ALIASES_FILE);
  else if (!path && opts.config) {
    const loaded = readConfigFile(opts.config);
    if (loaded.ok) path = aliasesPathFor(loaded.resolve().source);
  }
  const aliases = path ? readAliasesFile(path) : undefined;
  if (opts.aliases && !aliases) throw new Error(`alias file not found: ${path}`);
  return aliases ?? {};
}

export function findDeprecated(
  aliases: AliasMap,
  refs: readonly { key: string; dynamic: boolean; line: number; file: string }[],
  today: string,
): DeprecatedRef[] {
  const byKey = new Map<string, DeprecatedRef["refs"]>();
  for (const r of refs) {
    if (r.dynamic || !Object.hasOwn(aliases, r.key)) continue;
    const list = byKey.get(r.key) ?? [];
    if (!list.some((x) => x.file === r.file && x.line === r.line)) list.push({ file: r.file, line: r.line });
    byKey.set(r.key, list);
  }
  return [...byKey.keys()].sort().map((key) => {
    const { to, removeAfter } = aliases[key]!;
    return {
      key,
      to,
      ...(removeAfter ? { removeAfter } : {}),
      expired: removeAfter !== undefined && removeAfter < today,
      refs: byKey.get(key)!.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    };
  });
}

export async function runScan(opts: ScanOptions): Promise<ScanResult> {
  const presets = opts.presets ?? [...USAGE_PRESET_NAMES];
  for (const p of presets) {
    if (!USAGE_PRESET_NAMES.includes(p)) {
      throw new Error(`unknown --preset "${p}" (expected one of: ${USAGE_PRESET_NAMES.join(", ")})`);
    }
  }
  const patterns = (opts.keyPatterns ?? []).map(compileKeyPattern);
  const { defaultLocale, catalogs } = await loadCatalogs({
    locales: opts.locales,
    config: opts.config,
    defaultLocale: opts.defaultLocale,
  });
  const files = collectSourceFiles(opts.sources);
  const keys = Object.keys(catalogs[defaultLocale]!);
  const aliases = await loadAliases(opts);
  const known = new Set([...keys, ...Object.keys(aliases)]);
  if (presets.includes("i18next")) for (const k of keys) known.add(pluralFamily(k)?.base ?? k);
  const refs = files.flatMap((f) => findKeyRefs(readFileSync(f, "utf8"), presets, patterns, known).map((r) => ({ ...r, file: f })));
  const classified = classifyKeys(keys, refs, {
    pluralSuffixes: presets.includes("i18next"),
  });
  const deprecated = findDeprecated(aliases, refs, (opts.now ?? new Date()).toISOString().slice(0, 10));
  const ok = (classified.unused.length === 0 || !!opts.allowUnused) && !deprecated.some((d) => d.expired);
  return { ok, defaultLocale, files: files.length, ...classified, deprecated };
}

export function printScanResult(result: ScanResult, opts: { json: boolean }): void {
  process.exitCode = result.ok ? EXIT_OK : EXIT_PROBLEMS;
  if (opts.json) return printJson(result);
  const { used, dynamic, unused, deprecated } = result;
  const total = used.length + dynamic.length + unused.length;
  console.log(`typren-locale scan: ${total} key(s) in ${result.defaultLocale}, ${result.files} source file(s)`);
  console.log(`  used ${used.length}, dynamic ${dynamic.length}, unused ${unused.length}`);
  if (dynamic.length > 0) {
    console.log("  dynamic (matched by a runtime prefix, not reported unused):");
    const byPrefix = new Map<string, string[]>();
    for (const d of dynamic) byPrefix.set(d.prefix, [...(byPrefix.get(d.prefix) ?? []), d.key]);
    for (const [prefix, keys] of byPrefix) console.log(`    ${prefix}  ${keys.join(", ")}`);
  }
  if (unused.length > 0) {
    console.log("  unused:");
    for (const key of unused) console.log(`    ${key}`);
  }
  if (deprecated.length > 0) {
    console.log("  deprecated (still referenced):");
    for (const d of deprecated) {
      const status = d.expired ? `ERROR, removeAfter ${d.removeAfter} has passed` : `warning${d.removeAfter ? `, removeAfter ${d.removeAfter}` : ""}`;
      console.log(`    ${d.key} -> ${d.to ?? "(decommissioned)"}  [${status}]`);
      for (const r of d.refs) console.log(`      ${r.file}:${r.line}`);
    }
  }
  const expired = deprecated.filter((d) => d.expired).length;
  console.log(unused.length > 0 ? `typren-locale scan: ${unused.length} unused key(s).` : "typren-locale scan: no unused keys.");
  if (deprecated.length > 0) {
    console.log(`typren-locale scan: ${deprecated.length} deprecated key(s) still referenced${expired > 0 ? `, ${expired} past removeAfter` : ""}.`);
  }
}

export async function scanCommand(argv: string[]): Promise<void> {
  const parsed = parseStrictArgs(argv, SCAN_FLAGS);
  if (!parsed.ok) return fail("scan", parsed.error, parsed.json);
  const { args } = parsed;
  if (args.positionals.length === 0) {
    return fail(
      "scan",
      "usage: typren-locale scan [--locales <dir|file> | --config <path>] <src...>",
      args.json,
    );
  }
  try {
    const result = await runScan({
      sources: args.positionals,
      locales: args.strings.locales,
      config: args.strings.config,
      defaultLocale: args.strings["default-locale"],
      presets: args.lists.preset!.length > 0 ? (args.lists.preset as UsagePresetName[]) : undefined,
      keyPatterns: args.lists["key-pattern"],
      allowUnused: args.booleans.has("allow-unused"),
      aliases: args.strings.aliases,
    });
    printScanResult(result, { json: args.json });
  } catch (e) {
    fail("scan", errorMessage(e), args.json);
  }
}

export const SCAN_HELP = `usage: typren-locale scan [--locales <dir|file> | --config <path>] [options] <src...>

  Finds catalog keys that no source file references. <src...> are
  directories, files or globs; directories are walked for .js .jsx .mjs .cjs
  .ts .tsx .mts .cts .vue .svelte .html (node_modules, dist and .git are
  skipped). Only the default locale's keys are checked.

  --locales <dir|file>     a dir of <locale>.json files, or one file
  --config <path>          build config; its source is used without --locales
  --default-locale <id>    needed when several locales are present and the
                           config does not name one
  --preset <name>          repeatable; default: all of
                             vue-i18n    $t/t/tc/te/tm(), v-t, <i18n-t keypath>
                             i18next     t(), <Trans i18nKey>; "ns:key" reads as
                                         "ns.key"; the namespace from
                                         useTranslation('ns') is prefixed. Plural
                                         keys (key_one, key_other) count as used
                                         when "key" is referenced. Assumes the
                                         namespace is a top-level key
                             react-intl  <FormattedMessage id>, { id: '...' }
                             typren      t(catalog, 'key'), resolve(catalog, 'key')
  --key-pattern <regex>    repeatable; extra reference form, its first capture
                           group is the key
  --aliases <path>         alias file (default <dir>/_aliases.json next to the
                           catalogs, or the config's files source)
  --allow-unused           report unused keys but exit 0
  --json                   machine-readable result

  Dynamic keys ('a.' + x, \`a.\${x}\`) mark every key starting with that prefix
  as dynamic: listed, never reported unused. The longest prefix wins.

  Alias old keys (_aliases.json) still referenced in source are reported as
  deprecated, with file and line. That is a warning until the alias's
  removeAfter date has passed (or when it has none), then an error.

  Exit 0 when no keys are unused (or --allow-unused) and no deprecated key is
  past its removeAfter, 1 otherwise, 2 on a usage error or failure.
`;
