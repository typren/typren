import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseAliases, type AliasMap } from "../aliases";
import type { SourceConfig } from "./provider";

export const ALIASES_FILE = "_aliases.json";

/** Parsed alias file at `path`, or undefined when nothing exists there. Throws an Error naming `path` on invalid JSON or a malformed entry. */
export function readAliasesFile(path: string): AliasMap | undefined {
  if (!existsSync(path)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  return parseAliases(raw, path);
}

/** Deterministic output: keys sorted, entry field order to, since, removeAfter, 2-space indent, trailing "\n". */
export function writeAliasesFile(path: string, aliases: AliasMap): void {
  const out = Object.fromEntries(
    Object.keys(aliases)
      .sort()
      .map((key) => {
        const { to, since, removeAfter } = aliases[key]!;
        return [key, Object.fromEntries(Object.entries({ to, since, removeAfter }).filter(([, v]) => v !== undefined))];
      }),
  );
  mkdirSync(dirname(path), { recursive: true });
  // A symlink (even a dangling one) would redirect the write outside the locale directory.
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${path} is a symlink; refusing to write through it`);
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
}

/** `explicit` (--aliases) wins; else `<dir>/_aliases.json` for a "files" source; else undefined. */
export function aliasesPathFor(source: SourceConfig, explicit?: string): string | undefined {
  if (explicit) return explicit;
  return source.type === "files" ? join(source.dir, ALIASES_FILE) : undefined;
}
