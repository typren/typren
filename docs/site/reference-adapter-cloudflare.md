---
title: "@typren/adapter-cloudflare reference"
description: Every export, CLI command and error of the Cloudflare Workers host adapter.
category: Reference
order: 56
---

`@typren/adapter-cloudflare` ships a Cloudflare Workers + Static Assets host adapter for a
static-export site: the canonical Worker (directory-index rewrite, bare-to-slash
canonicalization, KV-backed redirect lookup, fail-open) and a `typren-cloudflare` CLI that writes
the wrangler config, bootstraps the redirects KV namespace, and diff-syncs
[`@typren/core`'s](./reference-core.md) `redirects()` into it.

**Not IaC.** It never creates a zone, account or DNS record beyond what `wrangler` itself manages
for a Worker and custom domain.

## "."

| Export | Signature | Notes |
|---|---|---|
| `renderWranglerConfig` | `(opts: RenderWranglerConfigOptions) => string` | Pure function; renders `wrangler.jsonc`'s contents. Validates `name` and every `domains` entry before writing them into config `wrangler` will act on. |
| `toKvEntries` | `(entries: RedirectEntry[], opts?: ToKvEntriesOptions) => { key: string; value: string }[]` | Wraps core's `toRedirectPairs`, adding the Workers KV 512-byte key limit check. |
| `KV_MAX_KEY_BYTES` | `512` | Workers KV's key size limit, measured on the percent-encoded key. |
| `syncRedirects` | `(client: KvClient, want: Map<string, string>, opts?: SyncOptions) => Promise<SyncResult>` | Idempotent: re-puts every wanted pair (KV `put` is idempotent and KV's own `list` returns no values to diff against), diffs only the key set to compute deletes. |
| `createWranglerKvClient` | `() => KvClient` | Shells out to `wrangler kv`; the CLI's default client. |
| `runWrangler` | `(args: string[]) => string` | Thin `wrangler` subprocess wrapper. |
| `createRedirectsNamespace` | `() => void` | Creates the `REDIRECTS` KV namespace via `wrangler`. |
| `deploy` | `() => void` | Runs `wrangler deploy`. |
| `REDIRECTS_BINDING` | `"REDIRECTS"` | The wrangler binding name `bootstrap`/the Worker expect. |
| `REDIRECTS_NAMESPACE` | `"typren-redirects"` | Default KV namespace name. |
| `scanContentStore`, `loadRedirectMap`, `mergeRedirectEntries` | re-exported from `@typren/core` | Host-agnostic redirect sourcing; re-exported so this package's own CLI/tests import everything from one place. See [reference-core](./reference-core.md). |
| `KvClient`, `KvPair`, `Env` | types | `KvClient` is the injected Workers KV surface (`listKeys`, `putMany`, `deleteMany`); `Env` is the Worker's `env` shape (`ASSETS`, optional `REDIRECTS`, `TYPREN_TRAILING_SLASH`, `TYPREN_CANONICAL_HOST`). |

### `RenderWranglerConfigOptions`

| Option | Type | Default | Notes |
|---|---|---|---|
| `name` | `string` | required | Must match Cloudflare's Worker-name rules (lowercase letters, digits, hyphens, 1-63 chars, no leading/trailing hyphen). |
| `assetsDir` | `string` | `"./out"` | |
| `domains` | `string[]` | `[]` | Each must be a bare hostname (no scheme, path or wildcard); becomes a custom-domain route. |
| `compatibilityDate` | `string` | required | |
| `accountId` | `string` | undefined | Pins the account for a login with access to several. |
| `trailingSlash` | `boolean` | `true` | `false` writes the Worker's `TYPREN_TRAILING_SLASH` var for Next's default bare-URL export. |
| `canonicalHost` | `string` | undefined | Written as `TYPREN_CANONICAL_HOST`: the Worker 301s every other hostname to this one. |

### `SyncOptions` / `SyncResult`

| Option | Type | Default | Notes |
|---|---|---|---|
| `dryRun` | `boolean` | `false` | Computes the diff, writes nothing. |
| `allowEmpty` | `boolean` | `false` | Required to let an empty desired state delete every live key (otherwise refuses: usually a wrong cwd or missing `--map`). |

`SyncResult` is `{ puts: KvPair[]; deletes: string[]; applied: boolean }`; `applied` is `false` for
a dry run or when the store already matched (nothing written).

## "./worker"

The Worker itself, kept out of the main entry so it never pulls `@typren/core`'s root (node,
jsdom, sharp) into a wrangler bundle; it imports only `@typren/core/static-host`.

| Export | Signature | Notes |
|---|---|---|
| default export | `{ fetch(request: Request, env: Env): Promise<Response> }` | Cloudflare Worker module. |

Request flow: canonical-host check (301 if the hostname doesn't match `TYPREN_CANONICAL_HOST`),
then `resolveStaticHostRequest` (from `@typren/core/static-host`) against the `REDIRECTS` KV
binding, producing a redirect (301), a rewrite (serves the canonical object path via
`env.ASSETS.fetch`), or a pass-through.

> **Security:** if `env.REDIRECTS` is absent (a site deployed before `bootstrap` ran), the lookup
> degrades to "no redirect" rather than failing the request — `resolveStaticHostRequest` fails
> open on a lookup rejection or null, so the site keeps serving with only the redirect feature
> unavailable.

## CLI (`typren-cloudflare`)

| Command | Flags | Notes |
|---|---|---|
| `init` | `--name`, `--assets-dir`, `--domain` (repeatable), `--canonical-host`, `--trailing-slash false`, `--account-id`, `--force` | Writes `wrangler.jsonc`. Refuses to overwrite an existing config unless `--force`. |
| `bootstrap` | `--content-dir`, `--map`, `--home-slug`, `--assets-dir`, `--trailing-slash false` | One-time, idempotent: creates the `REDIRECTS` KV namespace if missing, syncs redirects (same pipeline as `sync-redirects`), then deploys. Requires `init` to have run and the site to be built. |
| `sync-redirects` | `--content-dir`, `--map`, `--home-slug`, `--trailing-slash false`, `--allow-empty`, `--dry-run` | Diff-syncs redirects from two merged sources: page-declared aliases (core's `redirects()`) and an optional `--map` file (`.json`/`.mjs`/`.js` exporting `{ from, to }[]`). A site with no typren content dir syncs from the map alone. |
| `--help` | | Shows usage. |

> **Security:** an `.mjs`/`.js` map file is code and runs when loaded. A CI job running
> `sync-redirects --map something.mjs` on freshly merged changes executes them with the job's
> Cloudflare credentials; use the `.json` form in CI, or require review on map changes.

> **Cost:** every request not matching `/_next/*` invokes the Worker. Cloudflare's free plan
> includes 100,000 Worker requests/day; a site this central to every page load may need a paid
> plan beyond that.

## Errors

| Thrown from | Message prefix | Cause |
|---|---|---|
| `renderWranglerConfig` | `"<name>" is not a valid Worker name` | `name` fails Cloudflare's naming rules. |
| `renderWranglerConfig` | `"<domain>" is not a valid custom domain` | A `domains` entry isn't a bare hostname. |
| `toKvEntries` | `redirect "from" for "<slug>" exceeds the Workers KV 512-byte key limit` | An encoded redirect key is too large for KV. |
| `syncRedirects` | `refusing to delete all <n> live redirect(s) because the desired state is empty` | Empty `want` without `allowEmpty`; usually a wrong cwd or missing map. |
| CLI `init`/`bootstrap` | various, printed not thrown | See `printHelp`/`printInitResult` in `cli.ts`; failures return `{ ok: false, error }` rather than throwing, for a clean CLI exit path. |

See [deploy-cloudflare](./deploy-cloudflare.md) for the end-to-end deploy walkthrough.
