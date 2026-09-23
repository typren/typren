#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildRedirects } from "@typren/core";
import { scanContentStore } from "./content-scan";
import { loadRedirectMap, mergeRedirectEntries } from "./map-source";
import { toKvsEntries } from "./kvs-entries";
import { syncRedirects, type SyncResult } from "./sync";
import { bootstrapDistribution, type BootstrapResult } from "./bootstrap";
import { createAwsCliKvsClient, createAwsCliCloudFrontClient } from "./aws-cli-clients";
import type { KvsClient, CloudFrontClient } from "./types";

export const DEFAULT_STORE_NAME = "typren-redirects";

/** Same src/-vs-root auto-detect `typren review` uses (packages/cli/src/cli.ts). */
function detectContentDir(cwd: string): string {
  return fs.existsSync(path.join(cwd, "src")) ? path.join(cwd, "src", "content") : path.join(cwd, "content");
}

export type SyncRedirectsCliOptions = {
  contentDir?: string;
  storeName?: string;
  homeSlug?: string;
  dryRun?: boolean;
  /** Host-supplied redirect map file (.json, .mjs or .js exporting
   *  `{ from, to }[]`), merged with the content scan's frontmatter aliases.
   *  With no typren content dir at all, the map alone drives the sync, which
   *  is what a non-typren CloudFront site uses. */
  map?: string;
  /** `false` for a site whose canonical page URLs are the bare form: on-site
   *  targets are then synced verbatim instead of gaining the trailing slash.
   *  Default `true`, the trailing-slash static-export shape. */
  trailingSlash?: boolean;
  /** Permit an empty desired state to delete every live key (see sync.ts). */
  allowEmpty?: boolean;
};

export type SyncRedirectsCliResult = { ok: true; result: SyncResult } | { ok: false; error: string };

/** Core of `typren-cloudfront sync-redirects`: scans the content dir,
 *  validates+builds this site's redirects via `@typren/core`, and diff-syncs
 *  them into the named KeyValueStore. `client` is injected so this is
 *  testable without real AWS (the CLI wires the AWS-CLI-backed default). */
export async function runSyncRedirects(cwd: string, opts: SyncRedirectsCliOptions, client: KvsClient): Promise<SyncRedirectsCliResult> {
  try {
    const contentDir = opts.contentDir ? path.resolve(cwd, opts.contentDir) : detectContentDir(cwd);
    const store = scanContentStore(contentDir);
    const fromContent = buildRedirects(store, { homeSlug: opts.homeSlug });
    // Canonical public paths of the scanned pages, so a map entry can't
    // silently 301 a live page away (mergeRedirectEntries refuses shadows).
    const pagePaths = store.listPages().map((p) => (p.slug === opts.homeSlug ? "/" : `/${p.slug}`));
    const entries = opts.map
      ? mergeRedirectEntries(fromContent, await loadRedirectMap(cwd, opts.map), pagePaths)
      : fromContent;
    const want = new Map(
      toKvsEntries(entries, { appendSlash: opts.trailingSlash !== false }).map(({ key, value }) => [key, value])
    );
    const result = await syncRedirects(client, opts.storeName ?? DEFAULT_STORE_NAME, want, {
      dryRun: opts.dryRun,
      allowEmpty: opts.allowEmpty,
    });
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type BootstrapCliOptions = {
  distributionId?: string;
  storeName?: string;
  functionName?: string;
  force?: boolean;
};

/** Core of `typren-cloudfront bootstrap`. `kvsClient`/`cfClient` injected for
 *  the same reason as above. */
export async function runBootstrap(
  opts: BootstrapCliOptions,
  kvsClient: KvsClient,
  cfClient: CloudFrontClient
): Promise<BootstrapResult | { ok: false; error: string }> {
  if (!opts.distributionId) return { ok: false, error: "typren-cloudfront bootstrap: --distribution-id is required" };
  return bootstrapDistribution(kvsClient, cfClient, {
    distributionId: opts.distributionId,
    storeName: opts.storeName ?? DEFAULT_STORE_NAME,
    functionName: opts.functionName,
    force: opts.force,
  });
}

function printSyncResult(result: SyncRedirectsCliResult, opts: { dryRun?: boolean }): void {
  if (!result.ok) {
    console.error(`typren-cloudfront sync-redirects: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  const { puts, deletes, applied } = result.result;
  for (const p of puts) console.log(`  put    ${p.key} -> ${p.value}`);
  for (const d of deletes) console.log(`  delete ${d}`);
  if (puts.length === 0 && deletes.length === 0) {
    console.log("typren-cloudfront sync-redirects: already in sync.");
  } else if (opts.dryRun) {
    console.log(`typren-cloudfront sync-redirects: dry run — ${puts.length} put(s), ${deletes.length} delete(s) not applied.`);
  } else if (applied) {
    console.log(`typren-cloudfront sync-redirects: applied ${puts.length} put(s), ${deletes.length} delete(s).`);
  }
}

function printBootstrapResult(result: BootstrapResult | { ok: false; error: string }): void {
  if (!result.ok) {
    console.error(`typren-cloudfront bootstrap: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `typren-cloudfront bootstrap: ${result.createdKvs ? "created" : "reused"} the KeyValueStore, ` +
      `published+attached function ${result.functionArn}.`
  );
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

const KNOWN_COMMANDS = new Set(["sync-redirects", "bootstrap"]);

function printHelp(): void {
  console.log(`typren-cloudfront: CloudFront host adapter for typren

Usage:
  npx typren-cloudfront sync-redirects [--content-dir <path>] [--map <file>] [--store <name>] [--home-slug <slug>] [--trailing-slash false] [--allow-empty] [--dry-run]
  npx typren-cloudfront bootstrap --distribution-id <id> [--store <name>] [--function-name <name>] [--force]
  npx typren-cloudfront --help

  sync-redirects   Diff-sync this site's redirects into the named CloudFront
                   KeyValueStore (default "${DEFAULT_STORE_NAME}"). Two
                   sources, merged: page-declared aliases (@typren/core's
                   redirects()) and an optional --map file (.json/.mjs/.js
                   exporting { from, to }[]; targets may be on-site paths or
                   absolute http(s) URLs). A site with no typren content dir
                   syncs from the map alone. Idempotent; --dry-run prints the
                   diff without writing.

  bootstrap        One-time, guarded setup on an EXISTING distribution: create
                   the KeyValueStore if needed, publish the canonical
                   viewer-request function, and attach it. Does NOT create a
                   bucket or distribution. Refuses to replace a different
                   already-attached function unless --force is given.

  --help           Show this help.
`);
}

/** Real clients used by a direct run, overridable so tests can drive the
 *  full dispatch without ever shelling out to the real `aws` CLI. */
export type MainClients = { kvs?: KvsClient; cf?: CloudFrontClient };

/** `argv` defaults to the real process argv so a direct run needs no change,
 *  matching packages/cli/src/cli.ts's own `main()`. */
export async function main(argv: string[] = process.argv.slice(2), clients: MainClients = {}): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    printHelp();
    return;
  }
  const command = argv[0];
  if (!KNOWN_COMMANDS.has(command)) {
    console.error(`typren-cloudfront: unknown command "${command}" (only "sync-redirects" and "bootstrap" are supported)`);
    process.exitCode = 1;
    return;
  }
  const flags = parseFlags(argv.slice(1));
  const kvsClient = clients.kvs ?? createAwsCliKvsClient();

  // A value-taking flag followed by another flag parses as boolean true
  // (`--map --dry-run`): silently discarding it would run WITHOUT the map,
  // and with the empty-state delete guard off that's how a whole redirect
  // map gets wiped. Fail loud instead.
  const stringFlag = (name: string): string | undefined => {
    const value = flags[name];
    if (value === true) {
      console.error(`typren-cloudfront: --${name} requires a value`);
      process.exitCode = 1;
      return undefined;
    }
    return typeof value === "string" ? value : undefined;
  };

  if (command === "sync-redirects") {
    const opts: SyncRedirectsCliOptions = {
      contentDir: stringFlag("content-dir"),
      storeName: stringFlag("store"),
      homeSlug: stringFlag("home-slug"),
      dryRun: flags["dry-run"] === true,
      map: stringFlag("map"),
      trailingSlash: stringFlag("trailing-slash") !== "false",
      allowEmpty: flags["allow-empty"] === true,
    };
    if (process.exitCode === 1) return;
    const result = await runSyncRedirects(process.cwd(), opts, kvsClient);
    printSyncResult(result, opts);
    return;
  }

  // command === "bootstrap"
  const opts: BootstrapCliOptions = {
    distributionId: stringFlag("distribution-id"),
    storeName: stringFlag("store"),
    functionName: stringFlag("function-name"),
    force: flags.force === true,
  };
  if (process.exitCode === 1) return;
  const result = await runBootstrap(opts, kvsClient, clients.cf ?? createAwsCliCloudFrontClient());
  printBootstrapResult(result);
}

// Only run when executed directly, not when imported by cli.test.ts, same
// realpath-resolved guard as packages/cli/src/cli.ts (npx/npm invoke via a
// node_modules/.bin symlink Node's ESM loader resolves through).
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
