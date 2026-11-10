import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { isIsoDate, isValidKeyPath, parseAliases, validateAliases, type AliasMap } from "../aliases";
import { ALIASES_FILE, readAliasesFile, writeAliasesFile } from "../build/aliases-file";
import { normalizeLocaleKey } from "../build/provider";
import { merge, UNSAFE_KEYS } from "../delta";
import type { Catalog } from "../types";
import { parseStrictArgs, type FlagSpec } from "./args";
import { fail, printJson } from "./output";

export type AliasVerb = "rename" | "deprecate" | "prune-aliases";

export type AliasVerbResult =
  | { ok: true; verb: AliasVerb; aliasesPath: string; changedFiles: string[]; pruned: string[]; key?: string; to?: string }
  | { ok: false; verb: AliasVerb; exitCode: 1 | 2; problems: string[] };

interface LocaleFile {
  path: string;
  locale: string;
  raw: string;
  obj: Catalog;
  flat: boolean;
  indent: string;
  trailingNewline: boolean;
}

type Node = Catalog | string;

const isObj = (v: unknown): v is Catalog => typeof v === "object" && v !== null && !Array.isArray(v);

function clean(obj: Catalog): [string, Node][] {
  return Object.entries(obj).filter(([k]) => !UNSAFE_KEYS.has(k));
}

function readLocaleFiles(dir: string): LocaleFile[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    throw new Error(`cannot read directory "${dir}": ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  return entries
    .filter((d) => d.isFile() && extname(d.name) === ".json" && d.name !== ALIASES_FILE)
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const path = join(dir, name);
      const raw = readFileSync(path, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`${path} is not valid JSON`);
      }
      if (!isObj(parsed)) throw new Error(`${path} must contain a JSON object`);
      const obj = Object.fromEntries(clean(parsed));
      const values = Object.values(obj);
      const flat = values.every((v) => typeof v === "string") && Object.keys(obj).some((k) => k.includes("."));
      let locale: string;
      try {
        locale = normalizeLocaleKey(name.slice(0, -".json".length));
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : String(e), { cause: e });
      }
      return {
        path,
        locale,
        raw,
        obj,
        flat,
        indent: /\n([ \t]+)"/.exec(raw)?.[1] ?? "  ",
        trailingNewline: raw.endsWith("\n"),
      };
    });
}

const segments = (f: LocaleFile, key: string): string[] => (f.flat ? [key] : key.split("."));

function getAt(obj: Catalog, parts: string[]): Node | undefined {
  let node: Node | undefined = obj;
  for (const p of parts) {
    if (!isObj(node) || !Object.hasOwn(node, p)) return undefined;
    node = node[p];
  }
  return node;
}

function removeAt(obj: Catalog, parts: string[]): Catalog {
  const [head, ...rest] = parts as [string, ...string[]];
  const entries: [string, Node][] = [];
  for (const [k, v] of clean(obj)) {
    if (k !== head) entries.push([k, v]);
    else if (rest.length > 0 && isObj(v)) {
      const next = removeAt(v, rest);
      if (Object.keys(next).length > 0) entries.push([k, next]);
    } else if (rest.length > 0) entries.push([k, v]);
  }
  return Object.fromEntries(entries);
}

function setAt(obj: Catalog, parts: string[], value: Node): Catalog {
  const [head, ...rest] = parts as [string, ...string[]];
  const entries = clean(obj);
  const idx = entries.findIndex(([k]) => k === head);
  const current = idx >= 0 ? entries[idx]![1] : undefined;
  const next = rest.length === 0 ? value : setAt(isObj(current) ? current : {}, rest, value);
  if (idx >= 0) entries[idx] = [head, next];
  else entries.push([head, next]);
  return Object.fromEntries(entries);
}

function renameLeaf(obj: Catalog, parts: string[], leaf: string): Catalog {
  const parent = parts.slice(0, -1);
  const old = parts[parts.length - 1]!;
  const swap = (o: Catalog): Catalog => Object.fromEntries(clean(o).map(([k, v]) => [k === old ? leaf : k, v]));
  if (parent.length === 0) return swap(obj);
  const container = getAt(obj, parent) as Catalog;
  return setAt(obj, parent, swap(container));
}

function hasKey(f: LocaleFile, key: string): boolean {
  return getAt(f.obj, segments(f, key)) !== undefined;
}

function blockedByLeaf(f: LocaleFile, key: string): boolean {
  if (f.flat) return false;
  const parts = key.split(".");
  return parts.slice(0, -1).some((_, i) => typeof getAt(f.obj, parts.slice(0, i + 1)) === "string");
}

function nestedCatalog(f: LocaleFile): Catalog {
  if (!f.flat) return f.obj;
  return merge({}, { changed: f.obj as Record<string, string>, removed: [] });
}

function serialize(f: LocaleFile): string {
  return JSON.stringify(f.obj, null, f.indent) + (f.trailingNewline ? "\n" : "");
}

function refuse(verb: AliasVerb, problems: string[]): AliasVerbResult {
  return { ok: false, verb, exitCode: 1, problems };
}

function dateFlag(flags: Record<string, string>, name: string): string | undefined {
  const v = flags[name];
  if (v === undefined) return undefined;
  if (!isIsoDate(v)) throw new Error(`--${name} must be a date like 2026-12-31`);
  return v;
}

const EDIT_SPEC: FlagSpec = { strings: ["dir", "since", "default-locale", "remove-after"], booleans: ["force"] };
const SPECS: Record<AliasVerb, FlagSpec> = {
  rename: EDIT_SPEC,
  deprecate: EDIT_SPEC,
  "prune-aliases": { strings: ["dir", "older-than"] },
};

function checkKey(key: string): void {
  if (!isValidKeyPath(key)) throw new Error(`invalid key "${key}"`);
}

function finish(
  verb: AliasVerb,
  dir: string,
  files: LocaleFile[],
  next: Map<LocaleFile, Catalog>,
  aliases: AliasMap,
  defaultLocale: string | undefined,
  key: string,
  to?: string,
): AliasVerbResult {
  const updated = files.map((f) => (next.has(f) ? { ...f, obj: next.get(f)! } : f));
  const catalogs = Object.fromEntries(updated.map((f) => [f.locale, nestedCatalog(f)]));
  const problems = validateAliases(aliases, catalogs, defaultLocale);
  try {
    parseAliases(aliases);
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  }
  if (problems.length > 0) return refuse(verb, problems);

  const changedFiles: string[] = [];
  for (const f of files) {
    if (!next.has(f)) continue;
    const out = serialize({ ...f, obj: next.get(f)! });
    if (out === f.raw) continue;
    writeFileSync(f.path, out);
    changedFiles.push(f.path);
  }
  const aliasesPath = join(dir, ALIASES_FILE);
  writeAliasesFile(aliasesPath, aliases);
  return { ok: true, verb, aliasesPath, changedFiles: changedFiles.sort(), pruned: [], key, ...(to ? { to } : {}) };
}

export async function runAliasVerb(verb: AliasVerb, args: string[], deps: { now?: Date } = {}): Promise<AliasVerbResult> {
  try {
    return run(verb, args, deps);
  } catch (e) {
    return { ok: false, verb, exitCode: 2, problems: [e instanceof Error ? e.message : String(e)] };
  }
}

function run(verb: AliasVerb, args: string[], deps: { now?: Date }): AliasVerbResult {
  const parsed = parseStrictArgs(args, SPECS[verb]);
  if (!parsed.ok) throw new Error(parsed.error);
  const { strings: flags, positionals } = parsed.args;
  const force = parsed.args.booleans.has("force");
  const dir = flags.dir ?? "./locales";
  const today = (deps.now ?? new Date()).toISOString().slice(0, 10);
  const since = flags.since ?? today;
  const rawDefault = flags["default-locale"];
  const defaultLocale = rawDefault === undefined ? undefined : normalizeLocaleKey(rawDefault);
  const aliasesPath = join(dir, ALIASES_FILE);
  const expected = verb === "rename" ? 2 : verb === "deprecate" ? 1 : 0;
  if (positionals.length !== expected) {
    throw new Error(`expected ${expected} positional argument(s), got ${positionals.length}`);
  }

  if (verb === "prune-aliases") {
    const cutoff = dateFlag(flags, "older-than") ?? today;
    const aliases = readAliasesFile(aliasesPath);
    const kept = Object.entries(aliases ?? {}).filter(([, a]) => !(a.removeAfter !== undefined && a.removeAfter < cutoff));
    const pruned = Object.keys(aliases ?? {}).filter((k) => !kept.some(([kk]) => kk === k)).sort();
    if (pruned.length > 0) writeAliasesFile(aliasesPath, Object.fromEntries(kept));
    return { ok: true, verb, aliasesPath, changedFiles: [], pruned };
  }

  const removeAfter = dateFlag(flags, "remove-after");
  const [key, target] = positionals as [string, string | undefined];
  checkKey(key);
  if (target !== undefined) {
    checkKey(target);
    if (target === key) throw new Error("old and new keys are identical");
    if (target.startsWith(`${key}.`) || key.startsWith(`${target}.`)) {
      throw new Error("one key is a dot-prefix of the other");
    }
  }

  const files = readLocaleFiles(dir);
  const aliases: AliasMap = readAliasesFile(aliasesPath) ?? {};
  if (Object.hasOwn(aliases, key)) return refuse(verb, [`"${key}" is already an alias key`]);
  if (target !== undefined && Object.hasOwn(aliases, target)) {
    return refuse(verb, [`"${target}" is already an alias key`]);
  }
  const holders = files.filter((f) => hasKey(f, key));
  const entry = { since, ...(removeAfter ? { removeAfter } : {}) };
  const next = new Map<LocaleFile, Catalog>();

  if (target === undefined) {
    if (holders.some((f) => typeof getAt(f.obj, segments(f, key)) !== "string")) {
      return refuse(verb, [`"${key}" is a subtree; deprecate its leaves`]);
    }
    if (holders.length === 0 && !force) return refuse(verb, [`"${key}" is absent from every locale file (use --force)`]);
    for (const f of holders) next.set(f, removeAt(f.obj, segments(f, key)));
    return finish(verb, dir, files, next, { ...aliases, [key]: { to: null, ...entry } }, defaultLocale, key);
  }

  if (holders.length === 0) return refuse(verb, [`"${key}" is absent from every locale file`]);
  const blocked = files.filter((f) => blockedByLeaf(f, target));
  if (blocked.length > 0) {
    return refuse(verb, blocked.map((f) => `${f.path}: a parent of "${target}" is a string, not an object`));
  }
  const subtree = files.filter((f) => isObj(getAt(f.obj, segments(f, target))));
  if (subtree.length > 0) return refuse(verb, subtree.map((f) => `${f.path}: "${target}" is a subtree`));
  const taken = files.filter((f) => hasKey(f, target));
  if (taken.length > 0 && !force) {
    return refuse(verb, taken.map((f) => `${f.path}: "${target}" already exists (use --force)`));
  }
  for (const f of holders) {
    const from = segments(f, key);
    const to = segments(f, target);
    const value = getAt(f.obj, from)!;
    const sameParent = from.length === to.length && from.slice(0, -1).every((p, i) => p === to[i]);
    if (!hasKey(f, target) && sameParent) next.set(f, renameLeaf(f.obj, from, to[to.length - 1]!));
    else next.set(f, removeAt(setAt(f.obj, to, value), from));
  }
  const repointed = Object.entries(aliases).map(([k, a]) => [k, a.to === key ? { ...a, to: target } : a]);
  return finish(
    verb,
    dir,
    files,
    next,
    Object.fromEntries([...repointed, [key, { to: target, ...entry }]]),
    defaultLocale,
    key,
    target,
  );
}

export function printAliasVerbResult(result: AliasVerbResult, opts: { json: boolean }): void {
  if (!result.ok) {
    if (result.exitCode === 2) return fail(result.verb, result.problems.join("; "), opts.json);
    process.exitCode = result.exitCode;
    if (opts.json) return printJson({ ok: false, verb: result.verb, problems: result.problems });
    for (const p of result.problems) console.error(`typren-locale ${result.verb}: ${p}`);
    return;
  }
  process.exitCode = 0;
  if (opts.json) return printJson(result);
  const n = result.changedFiles.length;
  if (result.verb === "prune-aliases") {
    console.log(`typren-locale prune-aliases: pruned ${result.pruned.length} alias(es)`);
    for (const k of result.pruned) console.log(`  ${k}`);
  } else if (result.verb === "rename") {
    console.log(`typren-locale rename: "${result.key}" \u2192 "${result.to}" in ${n} file(s); alias recorded in ${result.aliasesPath}`);
  } else {
    console.log(`typren-locale deprecate: "${result.key}" decommissioned in ${n} file(s); alias recorded in ${result.aliasesPath}`);
  }
}

const COMMON = `  --dir <dir>               Locale directory (default ./locales); aliases live in <dir>/${ALIASES_FILE}.
  --since <version>         Version or date recorded on the alias (default: today, UTC).
  --default-locale <tag>    Locale the alias targets are validated against (default: closest to "en").
`;
const TAIL = `  --json                    Print the result as JSON on stdout only.
  --help                    Show this help.

Exit 0 ok, 1 refused or invalid, 2 usage or failure.
`;

export const RENAME_HELP: string = `usage: typren-locale rename <old> <new> [--dir <dir>] [--remove-after <date>] [--force] [--json]

  Moves <old> to <new> in every locale file under --dir (keeping each file's
  shape and formatting) and records an alias so old builds keep resolving the
  old key. Existing aliases pointing at <old> are re-pointed to <new>. Nothing
  is written unless the result validates.

${COMMON}  --remove-after <date>    YYYY-MM-DD after which prune-aliases may drop the alias.
  --force                   Overwrite <new> where it already exists.
${TAIL}`;

export const DEPRECATE_HELP: string = `usage: typren-locale deprecate <key> [--dir <dir>] [--remove-after <date>] [--force] [--json]

  Removes <key> from every locale file under --dir and records a decommission
  alias (to: null). Refused if another alias still targets <key>.

${COMMON}  --remove-after <date>    YYYY-MM-DD after which prune-aliases may drop the alias.
  --force                   Record the alias even if <key> is in no locale file.
${TAIL}`;

export const PRUNE_ALIASES_HELP: string = `usage: typren-locale prune-aliases [--dir <dir>] [--older-than <date>] [--json]

  Removes alias entries whose removeAfter date is before the cutoff. Entries
  without removeAfter are kept. A later change will gate pruning on a
  reference scan; until then, check that nothing still uses the old keys.

  --dir <dir>               Locale directory (default ./locales).
  --older-than <date>       Cutoff YYYY-MM-DD (default: today, UTC).
${TAIL}`;
