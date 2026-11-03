import { existsSync, globSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { loadCatalogs } from "./catalogs";
import { parseStrictArgs, type FlagSpec } from "./args";
import { EXIT_OK, EXIT_PROBLEMS, errorMessage, fail, printJson } from "./output";
import { USAGE_PRESET_NAMES, compileKeyPattern, findKeyRefs, type KeyRef, type UsagePresetName } from "./usage-presets";
import { pluralFamily } from "./formats";

export const SCAN_FLAGS: FlagSpec = {
  strings: ["locales", "config", "default-locale"],
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
}

export interface ScanResult {
  /** No unused keys, or --allow-unused. */
  ok: boolean;
  defaultLocale: string;
  /** Source files scanned. */
  files: number;
  /** Catalog keys referenced statically, sorted. */
  used: string[];
  /** Keys covered only by a runtime-built prefix, sorted by key. */
  dynamic: { key: string; prefix: string }[];
  unused: string[];
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
  const known = new Set(keys);
  if (presets.includes("i18next")) for (const k of keys) known.add(pluralFamily(k)?.base ?? k);
  const refs = files.flatMap((f) => findKeyRefs(readFileSync(f, "utf8"), presets, patterns, known));
  const classified = classifyKeys(keys, refs, {
    pluralSuffixes: presets.includes("i18next"),
  });
  return { ok: classified.unused.length === 0 || !!opts.allowUnused, defaultLocale, files: files.length, ...classified };
}

export function printScanResult(result: ScanResult, opts: { json: boolean }): void {
  process.exitCode = result.ok ? EXIT_OK : EXIT_PROBLEMS;
  if (opts.json) return printJson(result);
  const { used, dynamic, unused } = result;
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
  console.log(unused.length > 0 ? `typren-locale scan: ${unused.length} unused key(s).` : "typren-locale scan: no unused keys.");
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
  --allow-unused           report unused keys but exit 0
  --json                   machine-readable result

  Dynamic keys ('a.' + x, \`a.\${x}\`) mark every key starting with that prefix
  as dynamic: listed, never reported unused. The longest prefix wins.

  Exit 0 when no keys are unused (or --allow-unused), 1 when unused keys are
  found, 2 on a usage error or failure.
`;
