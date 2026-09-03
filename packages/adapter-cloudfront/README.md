# @typren/adapter-cloudfront

CloudFront host adapter for typren's [`redirects()`](../core#readme) (page
frontmatter `aliases: string[]`). Ships the canonical viewer-request function
for a static-export site on an S3 REST origin, and a CLI that diff-syncs the
redirect map into a CloudFront KeyValueStore.

**Not IaC.** This package never creates a bucket or a distribution — that's
Terraform/CDK/SST territory. It's the thin, differentiated layer on top of
infra you already have.

## What it ships

1. **The canonical viewer-request function** (`redirects.function.js`, read
   via `readFunctionSource()`). One CloudFront Function, three jobs, because a
   distribution can attach only one viewer-request function:
   - **KVS-backed redirect lookup → 301.** The map lives in a CloudFront
     KeyValueStore, not in the function — a redirect edit never needs a
     function deploy, only a KVS sync.
   - **Directory-index rewrite.** An S3 REST origin has no index-document
     behaviour: `/about/` asks for the key `about/` and 404s unless rewritten
     to `about/index.html`. With `trailingSlash: true` every page is a
     directory like this — **drop this and the whole site 404s except `/`.**
   - **Bare → slash canonicalization**, so a legacy/indexed bare URL still
     resolves. A small set of known Next.js static-export metadata routes
     (`/opengraph-image`, `/twitter-image`, `/icon`, `/apple-icon`) pass
     through untouched — they're real extensionless objects, not directories.

   If the KeyValueStore is unreachable, only the redirect lookup degrades —
   the index rewrite and canonicalization keep the site serving. See
   `redirects.function.test.ts`.

2. **`typren-cloudfront sync-redirects`** — idempotent diff-sync of
   `@typren/core`'s `redirects()` into a named KeyValueStore:

   ```bash
   npx typren-cloudfront sync-redirects --store my-site-redirects
   npx typren-cloudfront sync-redirects --store my-site-redirects --dry-run
   ```

   Computes puts (new/changed keys) and deletes (live keys no longer wanted),
   no-ops when nothing changed, and chunks a larger changeset at the KVS
   `UpdateKeys` API's 50-change cap, chaining each write's returned ETag into
   the next. Requires the `aws` CLI on `PATH` with credentials for the target
   account (prod and staging are usually separate accounts — run once per
   account). Required IAM: `cloudfront:DescribeKeyValueStore`,
   `cloudfront-keyvaluestore:DescribeKeyValueStore`,
   `cloudfront-keyvaluestore:ListKeys`, `cloudfront-keyvaluestore:UpdateKeys`.

3. **`typren-cloudfront bootstrap`** (optional, guarded) — one-time setup on
   an distribution that already exists:

   ```bash
   npx typren-cloudfront bootstrap --distribution-id E1234567890ABC
   ```

   Creates the KeyValueStore if it doesn't exist, publishes the canonical
   function associated with it, and attaches the function to the
   distribution's default cache behavior. **Checks what's already attached
   first** — `FunctionAssociations` and a function's own config are
   whole-object writes, not merges, so blind-replacing whatever is there can
   take down a site that relies on a different function (this happened for
   real: a redirects-only function replacing one that also did the index
   rewrite 404'd every page but `/`). Bootstrap refuses to replace a
   *different* function unless you pass `--force`, after you've read what it
   does.

## Cache-control & invalidation

A redirect change here needs **no CloudFront invalidation at all** — the
function reads the KeyValueStore at request time, so `sync-redirects`
finishes and the new redirect is live within seconds. That's the point of
moving the map out of the function.

For everything else the static export serves:

- **Build output with content-hashed filenames** (`_next/static/**`, hashed
  assets): cache immutably — `Cache-Control: public, max-age=31536000,
  immutable`. A new build ships new filenames, so there's nothing to
  invalidate.
- **`index.html` / any HTML the export writes**: short or no cache
  (`Cache-Control: public, max-age=0, must-revalidate`, or `no-cache`). HTML
  is what actually changes on deploy and isn't content-hashed.
- **A real deploy** (new HTML, changed non-hashed assets) still needs an S3
  sync + a CloudFront invalidation of the HTML paths (`/*` or the changed
  set) — this package doesn't do deploys, only redirects.

## Testing without real AWS

Every AWS-touching operation is injected as a `KvsClient`/`CloudFrontClient`
(see `src/types.ts`) — the diff/chunk/ETag-chain logic (`sync.ts`) and the
guard/upsert flow (`bootstrap.ts`) are unit-tested against fakes, no AWS
account needed. `createAwsCliKvsClient()`/`createAwsCliCloudFrontClient()`
(the CLI's default) shell out to the `aws` CLI rather than adding the AWS SDK
as a dependency — swap in your own client behind the same interface if you
need something else.
