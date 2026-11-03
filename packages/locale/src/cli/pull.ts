import { resolveProvider, writeLocaleFiles, type FilenameStyle } from "../build";
import { applyAliasCopies, validateAliases } from "../aliases";
import { aliasesPathFor, readAliasesFile } from "../build/aliases-file";
import { readConfigFile } from "./config-file";

export interface PullOptions {
  configPath: string;
  outDir?: string;
  filenameStyle?: FilenameStyle;
  emitAliases?: boolean;
  aliasesPath?: string;
  defaultLocale?: string;
}

export type PullResult =
  | { ok: true; app: string; outDir: string; paths: Record<string, string> }
  | { ok: false; error: string };

/**
 * Core of `pull`: resolve `--config` into a `{ app, source }` build config,
 * load every locale from `source` via the normal provider port, and
 * materialize them as `<locale>.json` files under `--out` (default
 * `./locales`). No gates here (no-html, no dotted keys): those are `bake`'s
 * job, this verb is a raw snapshot for a human to read or hand to `bake`
 * later via the `files` provider.
 */
export async function runPull(opts: PullOptions): Promise<PullResult> {
  const loaded = readConfigFile(opts.configPath);
  if (!loaded.ok) return { ok: false, error: loaded.error };

  let config;
  try {
    config = loaded.resolve();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  let catalogs;
  try {
    catalogs = await resolveProvider(config.source).loadSource();
  } catch (e) {
    return { ok: false, error: `failed to load source: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (opts.emitAliases) {
    try {
      const path = aliasesPathFor(config.source, opts.aliasesPath);
      const aliases = path ? readAliasesFile(path) : undefined;
      if (!aliases) return { ok: false, error: "--emit-aliases needs an alias file (pass --aliases <path>)" };
      const problems = validateAliases(aliases, catalogs, opts.defaultLocale);
      if (problems.length) return { ok: false, error: `invalid aliases: ${problems.join("; ")}` };
      catalogs = Object.fromEntries(Object.entries(catalogs).map(([l, c]) => [l, applyAliasCopies(c, aliases)]));
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const outDir = opts.outDir ?? "./locales";
  const paths = writeLocaleFiles(catalogs, outDir, { filenameStyle: opts.filenameStyle });
  return { ok: true, app: config.app, outDir, paths };
}

export function printPullResult(result: PullResult): void {
  if (!result.ok) {
    console.error(`typren-locale pull: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  const locales = Object.keys(result.paths);
  console.log(`typren-locale pull: wrote ${locales.length} locale(s) for "${result.app}" to ${result.outDir}:`);
  for (const locale of locales) console.log(`  ${result.paths[locale]}`);
}

export const PULL_HELP = `usage: typren-locale pull --config <path> [options]

  Resolves --config's { app, source } build config, loads every locale from
  the source, and writes one <locale>.json file per locale (no build gates:
  see "bake" for the gated, hash-addressed publish).

  --config <path>              Build config file (required).
  --out <dir>                  Target directory (default ./locales).
  --filename-style <style>     "dash" (default) or "underscore" filenames.
  --emit-aliases               Write aliased old keys as copies of their targets, for i18n libraries
                               without a missing-key hook; output is a build artifact, not a source dir.
  --aliases <path>             Alias file (default <dir>/_aliases.json for a files source).
  --default-locale <tag>       Default catalog alias targets are checked against.
  --help                       Show this help.
`;
