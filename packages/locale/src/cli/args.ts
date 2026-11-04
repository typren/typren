/**
 * Hand-rolled flag parser shared by every verb, same style as
 * packages/adapter-cloudfront/src/cli.ts's parseFlags, extended with a
 * positionals list since `diff` and `compat` both take bare arguments
 * (directories, the "lokalise2 file download" subcommand words) alongside
 * flags. No dependency: a flag consumes the next token unless that token
 * itself looks like a flag, in which case it's a boolean.
 */
export interface ParsedArgs {
  flags: Record<string, string | boolean>;
  positionals: string[];
}

export function parseArgs(args: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { flags, positionals };
}

/** Reads a flag as a string, ignoring it if it was passed as a bare boolean (no value). */
export function stringFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

export interface FlagSpec {
  /** Value flags; last occurrence wins. */
  strings?: readonly string[];
  /** Repeatable value flags, collected in order. */
  lists?: readonly string[];
  /** Flags that never take a value. "help" and "json" are always booleans, never list them. */
  booleans?: readonly string[];
}
export interface StrictArgs {
  strings: Record<string, string>;
  lists: Record<string, string[]>;
  booleans: Set<string>;
  positionals: string[];
  json: boolean;
}
export type StrictParse = { ok: true; args: StrictArgs } | { ok: false; error: string; json: boolean };

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** Closest candidate within edit distance 2 (and under the input's length); first wins a tie. */
export function suggest(input: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const d = distance(input, candidate);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best !== undefined && bestDistance <= 2 && bestDistance < input.length ? best : undefined;
}

/** Strict flag parser for the key-tooling verbs: unknown flags and missing values are errors, not silent booleans. */
export function parseStrictArgs(argv: readonly string[], spec: FlagSpec): StrictParse {
  const strings = new Set(spec.strings ?? []);
  const lists = new Set(spec.lists ?? []);
  const booleans = new Set([...(spec.booleans ?? []), "help", "json"]);
  const out: StrictArgs = {
    strings: {},
    lists: Object.fromEntries([...lists].map((name) => [name, [] as string[]])),
    booleans: new Set(),
    positionals: [],
    json: false,
  };
  const fail = (error: string): StrictParse => ({ ok: false, error, json: argv.includes("--json") });

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      out.positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      out.positionals.push(arg);
      continue;
    }
    if (!arg.startsWith("--")) return fail(`unknown flag ${arg}`);

    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);

    if (booleans.has(name)) {
      if (inline !== undefined) return fail(`--${name} takes no value`);
      out.booleans.add(name);
    } else if (strings.has(name) || lists.has(name)) {
      let value = inline;
      if (value === undefined) {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) return fail(`--${name} needs a value`);
        value = next;
        i++;
      }
      if (lists.has(name)) out.lists[name]!.push(value);
      else out.strings[name] = value;
    } else {
      const close = suggest(name, [...strings, ...lists, ...booleans]);
      return fail(`unknown flag --${name}${close ? ` (did you mean --${close}?)` : ""}`);
    }
  }
  out.json = out.booleans.has("json");
  return { ok: true, args: out };
}
