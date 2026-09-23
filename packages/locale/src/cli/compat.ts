import { existsSync, readFileSync } from "node:fs";
import { resolveProvider, writeLocaleFiles, type ExportApiSourceConfig, type LocaleSourceProvider } from "../build";
import { stringFlag } from "./args";

/**
 * Flags lokalise2's own `file download` accepts that this provider fixes on
 * our side (canonical serialization, our own placeholder/bundle handling):
 * accepted for drop-in compat, otherwise a no-op. Listed once here so both
 * the notice line and the help text stay in sync.
 */
const IGNORED_FLAGS = ["format", "placeholder-format", "bundle-structure", "export-empty-as", "async", "indentation"];

/**
 * Tiny line-scan for a lokalise2 `config.yml`'s `api-token`/`project-id`
 * keys, no yaml dependency. Same regex-line-scan technique as the reference
 * at ~/GitHub/Work/locale-adapter packages/build/bin/cli.mjs's
 * `parseLokaliseYamlConfig`, this package's own independent implementation.
 */
export function parseLokaliseYamlConfig(text: string): { apiToken?: string; projectId?: string } {
  const grab = (key: string): string | undefined => {
    const match = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "m").exec(text);
    return match?.[1]?.trim().replace(/^["']|["']$/g, "");
  };
  return { apiToken: grab("api-token") ?? grab("token"), projectId: grab("project-id") };
}

export type CompatCredentialsResult = { ok: true; token: string; projectId: string } | { ok: false; error: string };

/** Resolves token/project-id from --config's config.yml, with --token/--project-id overriding whichever of those it carries. */
export function resolveCompatCredentials(flags: Record<string, string | boolean>): CompatCredentialsResult {
  let token = stringFlag(flags, "token");
  let projectId = stringFlag(flags, "project-id");

  const configPath = stringFlag(flags, "config");
  if (configPath) {
    if (!existsSync(configPath)) return { ok: false, error: `--config not found: ${configPath}` };
    const parsed = parseLokaliseYamlConfig(readFileSync(configPath, "utf8"));
    token ??= parsed.apiToken;
    projectId ??= parsed.projectId;
  }

  if (!token || !projectId) {
    return { ok: false, error: "could not resolve token/project-id: pass --token/--project-id or --config <config.yml>" };
  }
  return { ok: true, token, projectId };
}

/**
 * Maps resolved credentials onto the export-api config shape (`{ type:
 * "export-api", preset: "lokalise", projectId, token }`, `ExportApiSourceConfig`
 * from ../build). The provider deliberately rejects literal token values (a
 * secret must never sit in a committed config file), but compat legitimately
 * holds the literal in memory, read from the vendor's own config.yml. Bridge
 * the two policies through the process environment: stash the literal under a
 * compat-owned env var and hand the provider a `${VAR}` reference to it. The
 * secret never touches disk or logs, and the provider's policy stays intact.
 */
export const COMPAT_TOKEN_ENV_VAR = "TYPREN_LOCALE_COMPAT_TOKEN";

export function buildExportApiSourceConfig(credentials: { token: string; projectId: string }): ExportApiSourceConfig {
  process.env[COMPAT_TOKEN_ENV_VAR] = credentials.token;
  return {
    type: "export-api",
    preset: "lokalise",
    projectId: credentials.projectId,
    token: `\${${COMPAT_TOKEN_ENV_VAR}}`,
  };
}

export interface CompatDownloadOptions {
  flags: Record<string, string | boolean>;
  /** Test-only seam: an already-built provider bypasses credential resolution and resolveProvider entirely. */
  provider?: LocaleSourceProvider;
}

export type CompatDownloadResult =
  | { ok: true; targetDir: string; paths: Record<string, string>; ignoredFlags: string[] }
  | { ok: false; error: string };

/**
 * Core of `compat lokalise2 file download`: resolves token/project-id (never
 * logged, never written to disk), builds the export-api source config in
 * memory with the real token, and writes the provider's catalogs as
 * `<locale>.json` under the target dir with underscore-style filenames
 * (lokalise consumers expect `en_US.json`). This is a UX-compat translator,
 * not byte-identical: the output is our canonical serialization, not
 * lokalise's own export bytes.
 */
export async function runCompatDownload(opts: CompatDownloadOptions): Promise<CompatDownloadResult> {
  const { flags } = opts;
  const targetDir = stringFlag(flags, "unzip-to") ?? stringFlag(flags, "dest") ?? stringFlag(flags, "output");
  if (!targetDir) {
    return { ok: false, error: "missing target directory: pass --unzip-to <dir> (or --dest/--output)" };
  }

  const ignoredFlags = IGNORED_FLAGS.filter((f) => flags[f] !== undefined);

  let provider = opts.provider;
  if (!provider) {
    const credentials = resolveCompatCredentials(flags);
    if (!credentials.ok) return { ok: false, error: credentials.error };
    const source = buildExportApiSourceConfig(credentials);
    provider = resolveProvider(source);
  }

  let catalogs;
  try {
    catalogs = await provider.loadSource();
  } catch (e) {
    return { ok: false, error: `failed to load source: ${e instanceof Error ? e.message : String(e)}` };
  }

  const paths = writeLocaleFiles(catalogs, targetDir, { filenameStyle: "underscore" });
  return { ok: true, targetDir, paths, ignoredFlags };
}

export function printCompatResult(result: CompatDownloadResult): void {
  if (!result.ok) {
    console.error(`typren-locale compat: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  if (result.ignoredFlags.length > 0) {
    console.log(`typren-locale compat: ignoring --${result.ignoredFlags.join(", --")} (fixed to this provider's own export settings, no-op).`);
  }
  const locales = Object.keys(result.paths);
  console.log(`typren-locale compat: downloaded ${locales.length} locale(s) to ${result.targetDir}:`);
  for (const locale of locales) console.log(`  ${result.paths[locale]}`);
}

export const COMPAT_HELP = `usage: typren-locale compat lokalise2 file download [options]

  UX-compatible with lokalise2's "file download": accepts the same flags, so
  an existing \`lokalise2 file download ...\` invocation keeps working. NOT
  byte-identical output: files are this provider's own canonical
  serialization, written with underscore-style filenames (en_US.json) by
  default, since that's what lokalise consumers expect.

  --config <path>                lokalise2 config.yml (api-token/project-id).
  --token <token>                 Overrides --config's token.
  --project-id <id>                Overrides --config's project id.
  --unzip-to, --dest, --output <dir>
                                  Target directory (required).

  Accepted but ignored (this provider fixes these on our side, no-op):
  --format, --placeholder-format, --bundle-structure, --export-empty-as,
  --async, --indentation

  --help                          Show this help.
`;
