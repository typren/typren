import { buildCatalogs } from "../build";
import { aliasesPathFor, readAliasesFile } from "../build/aliases-file";
import { readConfigFile } from "./config-file";

export interface BakeOptions {
  configPath: string;
  outDir: string;
  /**
   * ponytail: not one of the spec'd flags (`bake --config <path> --out
   * <dir>` only). `buildCatalogs` requires a `buildVersion` string to stamp
   * the manifest and key the delta-history window, so this defaults to an
   * ISO timestamp when omitted. Escape hatch here (`--build-version`) for a
   * caller with a real release id (git sha, package version); wire one up
   * for real once the publish pipeline picks a convention.
   */
  buildVersion?: string;
  aliasesPath?: string;
  defaultLocale?: string;
}

export type BakeResult =
  | { ok: true; app: string; locales: string[]; hashes: Record<string, string>; deltaCount: number; aliasCount: number }
  | { ok: false; error: string };

/**
 * Core of `bake`: resolve `--config`, then run the full gated publish
 * (`buildCatalogs`: no-dotted-keys + no-HTML gates, content hashing, manifest
 * + precomputed deltas) into `--out`.
 */
export async function runBake(opts: BakeOptions): Promise<BakeResult> {
  const loaded = readConfigFile(opts.configPath);
  if (!loaded.ok) return { ok: false, error: loaded.error };

  let config;
  try {
    config = loaded.resolve();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  let aliases;
  try {
    const path = aliasesPathFor(config.source, opts.aliasesPath);
    aliases = path ? readAliasesFile(path) : undefined;
    if (opts.aliasesPath && !aliases) return { ok: false, error: `alias file not found: ${path}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const buildVersion = opts.buildVersion ?? new Date().toISOString();
  try {
    const result = await buildCatalogs(config.source, {
      app: config.app,
      buildVersion,
      outDir: opts.outDir,
      aliases,
      defaultLocale: opts.defaultLocale,
    });
    const hashes = Object.fromEntries(
      Object.entries(result.manifest.apps[config.app] ?? {}).map(([lang, entry]) => [lang, entry.hash]),
    );
    return {
      ok: true,
      app: config.app,
      locales: Object.keys(hashes), hashes, deltaCount: result.deltaPaths.length,
      aliasCount: aliases ? Object.keys(aliases).length : 0,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function printBakeResult(result: BakeResult): void {
  if (!result.ok) {
    console.error(`typren-locale bake: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`typren-locale bake: app "${result.app}", ${result.locales.length} locale(s), ${result.deltaCount} delta(s) written${result.aliasCount > 0 ? `, ${result.aliasCount} alias(es) served` : ""}.`);
  for (const locale of result.locales) console.log(`  ${locale}: ${result.hashes[locale]}`);
}

export const BAKE_HELP = `usage: typren-locale bake --config <path> --out <dir> [--build-version <v>]

  Resolves --config's { app, source } build config and runs the full gated
  publish (buildCatalogs): no-dotted-keys + no-HTML gates, content hashing,
  manifest, and precomputed deltas against prior releases under --out.

  --config <path>          Build config file (required).
  --out <dir>               Output directory (required).
  --build-version <v>       Release id stamped into the manifest (default: an ISO timestamp).
  --aliases <path>          Alias file (default <dir>/_aliases.json for a files source; aliased old keys are always served as copies).
  --default-locale <tag>    Default catalog alias targets are checked against.
  --help                    Show this help.
`;
