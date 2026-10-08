#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildRedirects, scanContentStore, loadRedirectMap, mergeRedirectEntries } from "@typren/core";
import { renderWranglerConfig } from "./wrangler-config";
import { toKvEntries } from "./kv-entries";
import { syncRedirects, type SyncResult } from "./sync";
import { createWranglerKvClient, createRedirectsNamespace, deploy, REDIRECTS_BINDING } from "./wrangler-cli";
import type { KvClient } from "./types";

const CONFIG_FILENAMES = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];

/** Whether the wrangler config in `cwd` declares a bare-URL export (init's
 *  `--trailing-slash false`), so sync-redirects/bootstrap emit matching
 *  redirect targets without the flag being repeated on every run. */
function configDeclaresBareUrls(cwd: string): boolean {
  const file = CONFIG_FILENAMES.map((f) => path.join(cwd, f)).find((f) => fs.existsSync(f));
  return file !== undefined && /"TYPREN_TRAILING_SLASH"\s*:\s*"false"/.test(fs.readFileSync(file, "utf8"));
}

/** Same src/-vs-root auto-detect `typren review` / adapter-cloudfront use. */
function detectContentDir(cwd: string): string {
  return fs.existsSync(path.join(cwd, "src")) ? path.join(cwd, "src", "content") : path.join(cwd, "content");
}

export type InitCliOptions = {
  name?: string;
  assetsDir?: string;
  domains?: string[];
  accountId?: string;
  trailingSlash?: boolean;
  canonicalHost?: string;
  force?: boolean;
};
export type InitCliResult = { ok: true } | { ok: false; error: string };

/** Core of `typren-cloudflare init`: writes `wrangler.jsonc` in `cwd`.
 *  Refuses to overwrite an existing wrangler config (any of the three
 *  formats wrangler itself recognizes) unless `--force`. */
export function runInit(cwd: string, opts: InitCliOptions): InitCliResult {
  if (!opts.name) return { ok: false, error: "typren-cloudflare init: --name is required" };

  const existing = CONFIG_FILENAMES.find((f) => fs.existsSync(path.join(cwd, f)));
  if (existing && !opts.force) {
    return { ok: false, error: `typren-cloudflare init: ${existing} already exists in this directory (pass --force to overwrite)` };
  }

  try {
    const config = renderWranglerConfig({
      name: opts.name,
      assetsDir: opts.assetsDir,
      domains: opts.domains,
      accountId: opts.accountId,
      trailingSlash: opts.trailingSlash,
      canonicalHost: opts.canonicalHost,
      compatibilityDate: new Date().toISOString().slice(0, 10),
    });
    fs.writeFileSync(path.join(cwd, "wrangler.jsonc"), config);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type SyncRedirectsCliOptions = {
  contentDir?: string;
  homeSlug?: string;
  /** Host-supplied redirect map file (.json, .mjs or .js exporting
   *  `{ from, to }[]`), merged with the content scan's frontmatter aliases.
   *  With no typren content dir at all, the map alone drives the sync. */
  map?: string;
  /** `false` for a site whose canonical page URLs are the bare form: on-site
   *  targets then sync verbatim instead of gaining the trailing slash.
   *  Default `true`, the trailing-slash static-export shape. */
  trailingSlash?: boolean;
  /** Permit an empty desired state to delete every live key (see sync.ts). */
  allowEmpty?: boolean;
  dryRun?: boolean;
};
export type SyncRedirectsCliResult = { ok: true; result: SyncResult } | { ok: false; error: string };

/** Core of `typren-cloudflare sync-redirects`, also `bootstrap`'s step 4:
 *  scans the content dir, validates+builds this site's redirects via
 *  `@typren/core`, and diff-syncs them into the `REDIRECTS` KV namespace.
 *  `client` is injected so this is testable without a real Cloudflare
 *  account (the CLI wires the wrangler-backed default). */
export async function runSyncRedirects(cwd: string, opts: SyncRedirectsCliOptions, client: KvClient): Promise<SyncRedirectsCliResult> {
  try {
    const contentDir = opts.contentDir ? path.resolve(cwd, opts.contentDir) : detectContentDir(cwd);
    const store = scanContentStore(contentDir);
    const fromContent = buildRedirects(store, { homeSlug: opts.homeSlug });
    // Canonical public paths of the scanned pages, so a map entry can't
    // silently 301 a live page away (mergeRedirectEntries refuses shadows).
    const pagePaths = store.listPages().map((p) => (p.slug === opts.homeSlug ? "/" : `/${p.slug}`));
    const entries = opts.map ? mergeRedirectEntries(fromContent, await loadRedirectMap(cwd, opts.map), pagePaths) : fromContent;
    const want = new Map(toKvEntries(entries, { appendSlash: opts.trailingSlash !== false }).map(({ key, value }) => [key, value]));
    const result = await syncRedirects(client, want, { dryRun: opts.dryRun, allowEmpty: opts.allowEmpty });
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type BootstrapCliOptions = {
  contentDir?: string;
  homeSlug?: string;
  map?: string;
  trailingSlash?: boolean;
  assetsDir?: string;
};
export type BootstrapCliResult = { ok: true; createdNamespace: boolean; sync: SyncResult } | { ok: false; error: string };

/** The three operations `bootstrap` needs beyond `KvClient`, injected the
 *  same way so bootstrap's ordering (create -> sync -> deploy) is testable
 *  without ever shelling out to real `wrangler`. */
export type BootstrapClients = { kv: KvClient; createNamespace: () => void; deploy: () => void };

/**
 * Core of `typren-cloudflare bootstrap`: one-time, idempotent setup on a
 * site that already ran `init` and has been built.
 *   1. Refuses if no wrangler config exists in `cwd` (run `init` first).
 *   2. Refuses if the assets directory doesn't exist (build the site first).
 *   3. Creates the `REDIRECTS` KV namespace only if the config doesn't
 *      already declare that binding (a re-run after a manual edit, or a
 *      second `bootstrap`, is then a safe no-op for this step).
 *   4. Runs the same sync pipeline as `sync-redirects`.
 *   5. Deploys.
 */
export async function runBootstrap(cwd: string, opts: BootstrapCliOptions, clients: BootstrapClients): Promise<BootstrapCliResult> {
  const configFile = CONFIG_FILENAMES.find((f) => fs.existsSync(path.join(cwd, f)));
  if (!configFile) {
    return { ok: false, error: "typren-cloudflare bootstrap: no wrangler config found in this directory, run `typren-cloudflare init` first" };
  }

  const assetsDir = path.resolve(cwd, opts.assetsDir ?? "./out");
  if (!fs.existsSync(assetsDir)) {
    return { ok: false, error: `typren-cloudflare bootstrap: assets directory "${assetsDir}" does not exist, build the site first` };
  }

  const configText = fs.readFileSync(path.join(cwd, configFile), "utf8");
  let createdNamespace = false;
  if (!configText.includes(REDIRECTS_BINDING)) {
    clients.createNamespace();
    createdNamespace = true;
  }

  const syncResult = await runSyncRedirects(
    cwd,
    { contentDir: opts.contentDir, homeSlug: opts.homeSlug, map: opts.map, trailingSlash: opts.trailingSlash },
    clients.kv
  );
  if (!syncResult.ok) return syncResult;

  clients.deploy();
  return { ok: true, createdNamespace, sync: syncResult.result };
}

function printInitResult(result: InitCliResult): void {
  if (!result.ok) {
    console.error(`typren-cloudflare init: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  console.log("typren-cloudflare init: wrote wrangler.jsonc. Next: build the site, then run `typren-cloudflare bootstrap`.");
}

function printSyncResult(result: SyncRedirectsCliResult, opts: { dryRun?: boolean }): void {
  if (!result.ok) {
    console.error(`typren-cloudflare sync-redirects: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  const { puts, deletes, applied } = result.result;
  for (const p of puts) console.log(`  put    ${p.key} -> ${p.value}`);
  for (const d of deletes) console.log(`  delete ${d}`);
  if (opts.dryRun) {
    console.log(`typren-cloudflare sync-redirects: dry run — ${puts.length} put(s), ${deletes.length} delete(s) not applied.`);
  } else if (applied) {
    console.log(`typren-cloudflare sync-redirects: applied ${puts.length} put(s), ${deletes.length} delete(s).`);
  } else {
    console.log("typren-cloudflare sync-redirects: already in sync.");
  }
}

function printBootstrapResult(result: BootstrapCliResult): void {
  if (!result.ok) {
    console.error(`typren-cloudflare bootstrap: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `typren-cloudflare bootstrap: ${result.createdNamespace ? "created" : "reused"} the REDIRECTS KV namespace, ` +
      `synced ${result.sync.puts.length} put(s)/${result.sync.deletes.length} delete(s), deployed.`
  );
}

type FlagValue = string | boolean | string[];

function parseFlags(args: string[]): Record<string, FlagValue> {
  const flags: Record<string, FlagValue> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    let value: string | boolean;
    if (next !== undefined && !next.startsWith("--")) {
      value = next;
      i++;
    } else {
      value = true;
    }
    const existing = flags[key];
    if (existing === undefined) {
      flags[key] = value;
    } else if (Array.isArray(existing) && typeof value === "string") {
      existing.push(value);
    } else if (typeof existing === "string" && typeof value === "string") {
      flags[key] = [existing, value];
    } else {
      flags[key] = value; // a repeated boolean flag or a type clash: last wins
    }
  }
  return flags;
}

const KNOWN_COMMANDS = new Set(["init", "sync-redirects", "bootstrap"]);

function printHelp(): void {
  console.log(`typren-cloudflare: Cloudflare Workers + Static Assets host adapter for typren

Usage:
  npx typren-cloudflare init --name <worker-name> [--assets-dir ./out] [--domain <host>]... [--canonical-host <host>]
                         [--trailing-slash false] [--account-id <id>] [--force]
  npx typren-cloudflare bootstrap [--content-dir <path>] [--map <file>] [--home-slug <slug>] [--assets-dir ./out] [--trailing-slash false]
  npx typren-cloudflare sync-redirects [--content-dir <path>] [--map <file>] [--home-slug <slug>] [--trailing-slash false] [--allow-empty] [--dry-run]
  npx typren-cloudflare --help

  init             Write wrangler.jsonc in the current directory. Refuses to
                    overwrite an existing wrangler config unless --force.
                    --domain is repeatable; each becomes a custom-domain route.
                    --canonical-host 301s every other hostname to this one.
                    --trailing-slash false for Next's default bare-URL export
                    (bootstrap and sync-redirects then default to it too).
                    --account-id pins the account for multi-account logins.

  bootstrap        One-time, idempotent setup: creates the REDIRECTS KV
                    namespace if the config doesn't already have it, syncs
                    redirects (same pipeline as sync-redirects), then deploys.
                    Requires init to have run and the site to be built.

  sync-redirects   Diff-sync this site's redirects into the REDIRECTS KV
                    namespace. Two sources, merged: page-declared aliases
                    (@typren/core's redirects()) and an optional --map file
                    (.json/.mjs/.js exporting { from, to }[]; targets may be
                    on-site paths or absolute http(s) URLs). A site with no
                    typren content dir syncs from the map alone. Idempotent;
                    --dry-run prints the diff without writing.

  --help           Show this help.
`);
}

/** Real clients used by a direct run, overridable so tests can drive the
 *  full dispatch without ever shelling out to the real `wrangler` CLI. */
export type MainClients = { kv?: KvClient; createNamespace?: () => void; deploy?: () => void };

/** `argv` defaults to the real process argv so a direct run needs no change,
 *  matching `@typren/adapter-cloudfront`'s own `main()`. */
export async function main(argv: string[] = process.argv.slice(2), clients: MainClients = {}): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    printHelp();
    return;
  }
  const command = argv[0];
  if (!KNOWN_COMMANDS.has(command)) {
    console.error(`typren-cloudflare: unknown command "${command}" (only "init", "sync-redirects" and "bootstrap" are supported)`);
    process.exitCode = 1;
    return;
  }
  const flags = parseFlags(argv.slice(1));
  const kvClient = clients.kv ?? createWranglerKvClient();

  // A value-taking flag followed by another flag parses as boolean true
  // (`--map --dry-run`): silently discarding it would run WITHOUT the map,
  // and with the empty-state delete guard off that's how a whole redirect
  // map gets wiped. Fail loud instead.
  // An explicit --trailing-slash wins; otherwise follow what init wrote.
  const trailingSlashFor = (cwd: string): boolean => {
    const value = stringFlag("trailing-slash");
    return value === undefined ? !configDeclaresBareUrls(cwd) : value !== "false";
  };
  const stringFlag = (name: string): string | undefined => {
    const value = flags[name];
    if (value === true) {
      console.error(`typren-cloudflare: --${name} requires a value`);
      process.exitCode = 1;
      return undefined;
    }
    return typeof value === "string" ? value : undefined;
  };

  if (command === "init") {
    const domainsValue = flags.domain;
    const domains = domainsValue === undefined ? [] : Array.isArray(domainsValue) ? domainsValue : typeof domainsValue === "string" ? [domainsValue] : undefined;
    if (domains === undefined) {
      console.error("typren-cloudflare: --domain requires a value");
      process.exitCode = 1;
      return;
    }
    const opts: InitCliOptions = {
      name: stringFlag("name"),
      assetsDir: stringFlag("assets-dir"),
      domains,
      accountId: stringFlag("account-id"),
      trailingSlash: stringFlag("trailing-slash") !== "false",
      canonicalHost: stringFlag("canonical-host"),
      force: flags.force === true,
    };
    if (process.exitCode === 1) return;
    printInitResult(runInit(process.cwd(), opts));
    return;
  }

  if (command === "sync-redirects") {
    const opts: SyncRedirectsCliOptions = {
      contentDir: stringFlag("content-dir"),
      homeSlug: stringFlag("home-slug"),
      dryRun: flags["dry-run"] === true,
      map: stringFlag("map"),
      trailingSlash: trailingSlashFor(process.cwd()),
      allowEmpty: flags["allow-empty"] === true,
    };
    if (process.exitCode === 1) return;
    const result = await runSyncRedirects(process.cwd(), opts, kvClient);
    printSyncResult(result, opts);
    return;
  }

  // command === "bootstrap"
  const opts: BootstrapCliOptions = {
    contentDir: stringFlag("content-dir"),
    homeSlug: stringFlag("home-slug"),
    map: stringFlag("map"),
    trailingSlash: trailingSlashFor(process.cwd()),
    assetsDir: stringFlag("assets-dir"),
  };
  if (process.exitCode === 1) return;
  const result = await runBootstrap(process.cwd(), opts, {
    kv: kvClient,
    createNamespace: clients.createNamespace ?? createRedirectsNamespace,
    deploy: clients.deploy ?? deploy,
  });
  printBootstrapResult(result);
}

// Only run when executed directly, not when imported by cli.test.ts, same
// realpath-resolved guard as @typren/adapter-cloudfront's cli.ts (npx/npm
// invoke via a node_modules/.bin symlink Node's ESM loader resolves through).
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) main();
