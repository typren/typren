---
title: "@typren/adapter-cloudfront reference"
description: Every export, CLI command and error of the CloudFront host adapter.
category: Reference
order: 57
---

`@typren/adapter-cloudfront` ships the canonical viewer-request function for a static-export
site on an S3 REST origin, and a `typren-cloudfront` CLI that diff-syncs
[`@typren/core`'s](./reference-core.md) `redirects()` into a CloudFront KeyValueStore.

**Not IaC.** It never creates a bucket or a distribution; that's Terraform/CDK/SST territory.

## "."

| Export | Signature | Notes |
|---|---|---|
| `readFunctionSource` | `(opts?: FunctionSourceOptions) => string` | Reads the selected function variant fresh off disk (`redirects.function.js` by default, `redirects-bare-url.function.js` when `opts.trailingSlash` is `false`), templating in `opts.extraPassthroughSegments`. |
| `toKvsEntries` | `(entries: RedirectEntry[], opts?: ToKvsEntriesOptions) => KvsPair[]` | Wraps core's `toRedirectPairs`, adding the KeyValueStore's byte limits. |
| `KVS_MAX_KEY_BYTES` | `512` | CloudFront KeyValueStore key size limit. |
| `KVS_MAX_VALUE_BYTES` | `1024` | CloudFront KeyValueStore value size limit. |
| `syncRedirects` | `(kvsClient, cfClient, want, opts?) => Promise<SyncResult>` | See Options below. |
| `KVS_UPDATE_BATCH_SIZE` | `50` | CloudFront KVS `UpdateKeys`'s own per-call change cap; a larger changeset is chunked, chaining each write's returned ETag into the next. |
| `bootstrapDistribution` | `(kvsClient, cfClient, opts: BootstrapOptions) => Promise<BootstrapResult>` | One-time, guarded setup on an EXISTING distribution. |
| `DEFAULT_FUNCTION_NAME` | `"typren-redirects"` | |
| `scanContentStore`, `loadRedirectMap`, `mergeRedirectEntries` | re-exported from `@typren/core` | Host-agnostic redirect sourcing; re-exported here so this package's public API is self-contained. See [reference-core](./reference-core.md). |
| `createAwsCliKvsClient`, `createAwsCliCloudFrontClient` | `() => KvsClient` / `() => CloudFrontClient` | Shell out to the `aws` CLI; the CLI's default clients. |
| `KvsClient`, `CloudFrontClient`, `KvsPair` | types | Injected data/control-plane interfaces (see below), so the diff/chunk/ETag-chain logic and the bootstrap guard are unit-testable without real AWS. |

### `FunctionSourceOptions`

| Option | Type | Default | Notes |
|---|---|---|---|
| `trailingSlash` | `boolean` | `true` | `false` reads the bare-URL function instead of the trailing-slash/directory-index one. Mirrors `sync-redirects`' own flag; keep both in sync for a site. |
| `extraPassthroughSegments` | `string[]` | `[]` | Extra path-convention segments (beyond the built-in Next metadata names and `/.well-known/`) that are real extensionless objects, never redirected or rewritten. Each must match `/^[A-Za-z0-9_-]+$/`; templated into the published function's JS source via `JSON.stringify`, never string concatenation, so an invalid segment is rejected here rather than reaching the template. |

### `ToKvsEntriesOptions`

| Option | Type | Default | Notes |
|---|---|---|---|
| `appendSlash` | `boolean` | `true` | Appends the canonical trailing slash to on-site targets (the `trailingSlash: true` static-export shape). A bare-URL-canonical site passes `false`. |

### `SyncOptions` / `SyncResult`

| Option | Type | Default | Notes |
|---|---|---|---|
| `dryRun` | `boolean` | `false` | Computes the diff, writes nothing. |
| `allowEmpty` | `boolean` | `false` | Required to let an empty desired state delete every live key. |

`SyncResult` matches `@typren/adapter-cloudflare`'s shape: `{ puts, deletes, applied }`.

### `BootstrapOptions` / `BootstrapResult`

| Option | Type | Default | Notes |
|---|---|---|---|
| `distributionId` | `string` | required | Must already exist; this function never creates one. |
| `storeName` | `string` | required | |
| `functionName` | `string` | `DEFAULT_FUNCTION_NAME` ("typren-redirects") | |
| `force` | `boolean` | `false` | Required to proceed when a DIFFERENT viewer-request function is already attached; `FunctionAssociations` is a whole-list write, and blind-replacing what's there has caused a real outage before. |
| `trailingSlash` | `boolean` | `true` | Passed through to `readFunctionSource`: `false` publishes the bare-URL function. |
| `extraPassthroughSegments` | `string[]` | `[]` | Passed through to `readFunctionSource`. |

`BootstrapResult` is `{ ok: true; createdKvs: boolean; functionArn: string } | { ok: false; error: string }`.

### `KvsClient` / `CloudFrontClient`

| Interface | Methods |
|---|---|
| `KvsClient` | `describeStore(name)`, `listKeys(arn)` (returns items + ETag), `updateKeys(arn, etag, puts, deletes)` (at most 50 changes, CAS'd on `etag`, returns the new ETag). |
| `CloudFrontClient` | `getAttachedFunctionNames(distributionId)`, `createKeyValueStore(name, comment)`, `upsertFunction(name, code, kvsArn, comment)` (create-or-update, then publish DEVELOPMENT to LIVE), `setViewerRequestFunction(distributionId, functionArn)` (REPLACES whatever viewer-request function was there; `FunctionAssociations` is a whole-list write, not an append). |

## The canonical viewer-request function

One CloudFront Function does three jobs, because a distribution can attach only one
viewer-request function:

- **KVS-backed redirect lookup → redirect.** The map lives in a CloudFront KeyValueStore, not in
  the function, so a redirect edit never needs a function deploy, only a KVS sync. Defaults to
  301; a `--map` entry's `status` (302/307/308) rides along as a `"<status> "` prefix on the
  stored value.
- **Directory-index rewrite.** An S3 REST origin has no index-document behavior: `/about/` asks
  for the key `about/` and 404s unless rewritten to `about/index.html`.
- **Bare-to-slash canonicalization**, so a legacy/indexed bare URL still resolves. A small set of
  known Next.js static-export metadata routes (`/opengraph-image`, `/twitter-image`, `/icon`,
  `/apple-icon`) pass through untouched.

> **Security:** if the KeyValueStore is unreachable, only the redirect lookup degrades; the index
> rewrite and canonicalization keep the site serving.

## CLI (`typren-cloudfront`)

| Command | Flags | Notes |
|---|---|---|
| `sync-redirects` | `--content-dir`, `--map`, `--store`, `--home-slug`, `--trailing-slash false`, `--allow-empty`, `--dry-run` | Diff-syncs into the named KeyValueStore (default `DEFAULT_STORE_NAME`). Two merged sources, same as `sync-redirects` above. Required IAM: `cloudfront:DescribeKeyValueStore`, `cloudfront-keyvaluestore:DescribeKeyValueStore`, `cloudfront-keyvaluestore:ListKeys`, `cloudfront-keyvaluestore:UpdateKeys`. |
| `bootstrap` | `--distribution-id` (required), `--store`, `--function-name`, `--trailing-slash false`, `--extra-passthrough <seg,seg>`, `--force` | One-time, guarded setup on an existing distribution: creates the KeyValueStore if needed, publishes the canonical function, attaches it. `--trailing-slash false` publishes the bare-URL function instead (keep in sync with `sync-redirects`' own flag). `--extra-passthrough` is a comma-separated list of extra path-convention segments, templated into the published function. Refuses to replace a different already-attached function unless `--force`. |
| `--help` | | Shows usage. |

> **Security:** an `.mjs`/`.js` `--map` file is code and runs when loaded; a CI job executing it
> on freshly merged changes runs it with the job's AWS credentials. Use the `.json` form in CI, or
> require review on map changes. `cloudfront-keyvaluestore:UpdateKeys` is the real sensitive
> permission: whoever holds it controls where this site's redirects point.

> **Cost:** a redirect change needs no CloudFront invalidation (the function reads the
> KeyValueStore at request time); build output still needs the usual S3 sync + invalidation of
> changed HTML paths, which this package doesn't do.

## Errors

| Thrown from | Message prefix | Cause |
|---|---|---|
| `toKvsEntries` | `redirect "from" for "<slug>" exceeds the CloudFront KVS 512-byte key limit` | Encoded key too large. |
| `toKvsEntries` | `redirect "to" for "<slug>" exceeds the CloudFront KVS 1024-byte value limit` | Encoded value too large. |
| `syncRedirects` | refuses to delete all live keys | Empty desired state without `allowEmpty`. |
| `bootstrapDistribution` | `distribution "<id>" already has a different viewer-request function attached` | A different function is attached and `force` wasn't passed. |
| sync validation (per `@typren/core`'s map loader) | various | A `from` declared by both sources, a self-redirect, a map `from` shadowing a live page, or a protocol-relative/backslash/control-character value. |

See [deploy-cloudfront](./deploy-cloudfront.md) for the end-to-end deploy walkthrough.
