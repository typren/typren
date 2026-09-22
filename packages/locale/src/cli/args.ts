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
