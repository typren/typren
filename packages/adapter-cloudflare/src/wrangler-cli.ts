// Real Workers KV client plus the namespace-create/deploy calls bootstrap.ts
// needs, all shelling out to `wrangler` (mirrors
// `@typren/adapter-cloudfront`'s `aws-cli-clients.ts`: no SDK, no new
// runtime dependency; auth is whatever `wrangler login` /
// `CLOUDFLARE_API_TOKEN` already set up).
//
// ponytail: thin, mechanical glue, run `wrangler ... --output json`-ish,
// parse, done. Excluded from the coverage gate (see vitest.config.ts)
// because exercising it for real needs a live Cloudflare account; the
// actual logic (the diff in sync.ts) is fully unit-tested against the
// `KvClient` interface with a fake. Upgrade path if a CLI-less environment
// ever needs this: swap in a Cloudflare-API-backed implementation behind the
// same interface, nothing above this file changes.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { KvClient } from "./types";

export const REDIRECTS_BINDING = "REDIRECTS";
export const REDIRECTS_NAMESPACE = "typren-redirects";

/** Runs `wrangler <args>` via `npx` (rather than requiring it on PATH):
 *  every quickstart in this package's README already has the site install
 *  `wrangler` as a devDependency, and `npx` resolves that local install the
 *  same way `npx typren-cloudflare` itself is invoked. */
export function runWrangler(args: string[]): string {
  try {
    return execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT") {
      throw new Error("typren-cloudflare: could not run `npx wrangler`. Install wrangler as a devDependency and run `wrangler login` first.", { cause: e });
    }
    throw e;
  }
}

/** Writes `content` to a fresh temp file for the lifetime of `fn`, for
 *  `wrangler kv bulk put/delete`'s file-only arguments. */
function withTempFile<T>(content: string, fn: (file: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), "typren-cloudflare-"));
  const file = path.join(dir, "payload.json");
  try {
    writeFileSync(file, content);
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `createWranglerKvClient`'s default binding and `--remote` (this package
 *  never reads/writes wrangler's local KV emulator; the whole point of
 *  moving redirects into KV is editing production without a redeploy). */
export function createWranglerKvClient(): KvClient {
  return {
    async listKeys() {
      const out = runWrangler(["kv", "key", "list", "--binding", REDIRECTS_BINDING, "--remote"]);
      const items = JSON.parse(out) as { name: string }[];
      return items.map((i) => i.name);
    },
    async putMany(pairs) {
      if (pairs.length === 0) return;
      withTempFile(JSON.stringify(pairs), (file) => runWrangler(["kv", "bulk", "put", file, "--binding", REDIRECTS_BINDING, "--remote"]));
    },
    async deleteMany(keys) {
      if (keys.length === 0) return;
      withTempFile(JSON.stringify(keys), (file) => runWrangler(["kv", "bulk", "delete", file, "--binding", REDIRECTS_BINDING, "--remote", "--force"]));
    },
  };
}

/** Creates the KV namespace and writes its id into `wrangler.jsonc`'s
 *  `REDIRECTS` binding (`--update-config`). Safe to call once; bootstrap.ts
 *  only calls this when the config doesn't already declare the binding. */
export function createRedirectsNamespace(): void {
  runWrangler(["kv", "namespace", "create", REDIRECTS_NAMESPACE, "--binding", REDIRECTS_BINDING, "--update-config"]);
}

/** `wrangler deploy`, reading `wrangler.jsonc` from the cwd like every other
 *  wrangler invocation here. */
export function deploy(): void {
  runWrangler(["deploy"]);
}
