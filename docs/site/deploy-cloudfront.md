---
title: Deploy to CloudFront
description: Serve a static-export Typren site from CloudFront and S3 with @typren/adapter-cloudfront.
category: Guides
order: 22
---

`@typren/adapter-cloudfront` is a CloudFront host adapter for Typren's
`redirects()` (page frontmatter `aliases: string[]`), for a static export on
an S3 REST origin. It ships the canonical viewer-request function and a CLI
that diff-syncs the redirect map into a CloudFront KeyValueStore. It is not
infrastructure-as-code: it never creates a bucket or a distribution.

## What it ships

**The canonical viewer-request function** (`redirects.function.js`, read via
`readFunctionSource()`) does three jobs in one CloudFront Function, since a
distribution can attach only one:

- **KVS-backed redirect lookup → 301.** The map lives in a CloudFront
  KeyValueStore, not in the function, so a redirect edit never needs a
  function deploy, only a KVS sync.
- **Directory-index rewrite.** An S3 REST origin has no index-document
  behavior: `/about/` asks for the key `about/` and 404s unless rewritten to
  `about/index.html`. With `trailingSlash: true` every page is a directory
  like this — drop this and the whole site 404s except `/`.
- **Bare → slash canonicalization**, so a legacy or indexed bare URL still
  resolves. A small set of Next.js static-export metadata routes
  (`/opengraph-image`, `/twitter-image`, `/icon`, `/apple-icon`) pass through
  untouched since they're real extensionless objects, not directories.

If the KeyValueStore is unreachable, only the redirect lookup degrades — the
index rewrite and canonicalization keep the site serving.

## Syncing redirects

```bash
npx typren-cloudfront sync-redirects --store my-site-redirects
npx typren-cloudfront sync-redirects --store my-site-redirects --map redirects.config.mjs
npx typren-cloudfront sync-redirects --store my-site-redirects --dry-run
```

Redirects come from two mergeable sources: `@typren/core`'s `redirects()`
(page frontmatter `aliases:`) and an optional `--map` file (`.json` array of
`{ "from": "/old", "to": "/new" }`, or `.mjs`/`.js` default or named
`REDIRECTS` export of the same shape) for legacy platform URLs, removed
pages, and paths that moved off-site. Validation fails loud on a `from`
declared by both sources, a self-redirect, a map `from` that shadows a live
page's path, and any protocol-relative, backslash, or control-character
value. An empty desired state refuses to delete every live key unless you
pass `--allow-empty`. A site with no Typren content at all can sync from the
map alone.

This requires the `aws` CLI on `PATH` with credentials for the target
account (run once per account — prod and staging are usually separate
accounts). Required IAM: `cloudfront:DescribeKeyValueStore`,
`cloudfront-keyvaluestore:DescribeKeyValueStore`,
`cloudfront-keyvaluestore:ListKeys`, `cloudfront-keyvaluestore:UpdateKeys`.

**Site shapes.** The canonical function serves the trailing-slash,
directory-index static-export shape on an S3 REST origin. A bare-URL-canonical
site (Next's `trailingSlash: false`, Hugo `uglyURLs`, plain `.html` files)
should not attach this function — bring your own viewer-request function for
that shape and sync with `--trailing-slash false`, which emits map targets
verbatim instead of slash-canonicalized.

## Bootstrap

```bash
npx typren-cloudfront bootstrap --distribution-id E1234567890ABC
```

One-time setup on a distribution that already exists: creates the
KeyValueStore if it doesn't exist, publishes the canonical function
associated with it, and attaches the function to the distribution's default
cache behavior. It checks what's already attached first — `FunctionAssociations`
and a function's own config are whole-object writes, not merges, so
blind-replacing whatever is there can take down a site relying on a
different function. Bootstrap refuses to replace a different function unless
you pass `--force`, after you've read what it does.

> **Security:** an `.mjs`/`.js` map file is code and runs when loaded. A CI
> job that runs `sync-redirects --map something.mjs` on freshly merged,
> lightly reviewed changes is executing those changes with the job's AWS
> credentials — use the `.json` form there, or require review on map
> changes. Markdown content gets no such power: the scan refuses gray-matter's
> `javascript` front-matter engine outright. `cloudfront-keyvaluestore:UpdateKeys`
> is a sensitive permission: whoever holds it controls where the site's
> redirects point.

## Scope

- Exact-path matches only — the KeyValueStore is an exact-key lookup, no
  wildcards or splats. Migrating a `_redirects`-style wildcard file means
  enumerating the real paths.
- Bootstrap touches the default cache behavior only. Distributions with
  extra cache behaviors (`/assets/*`, `/api/*`) need the function attached
  via your own IaC, or requests they match skip redirects and the index
  rewrite.
- Error pages are distribution config, not this package: an S3 REST origin
  returns XML `AccessDenied` for a missing page — set `CustomErrorResponses`
  for 403/404 → your `/404.html` in your IaC.
- Dotted page slugs (`/docs/v1.2`) read as file objects to the
  slash-canonicalization heuristic; give such a page an explicit
  trailing-slash target in the map.

## Cache control and invalidation

A redirect change here needs no CloudFront invalidation at all — the
function reads the KeyValueStore at request time, so `sync-redirects`
finishes and the redirect is live within seconds.

For everything else the static export serves: cache content-hashed build
output (`_next/static/**`) immutably (`Cache-Control: public,
max-age=31536000, immutable`); keep `index.html` and other HTML short- or
no-cache, since it isn't content-hashed and is what actually changes on
deploy. A real deploy (new HTML, changed non-hashed assets) still needs an S3
sync and a CloudFront invalidation of the HTML paths — this package doesn't
do deploys, only redirects.

> **Cost:** a partially failed multi-batch sync is benign — puts land before
> deletes, and re-running converges. There is no extra CloudFront
> invalidation cost for a redirect change, since the KVS lookup happens at
> request time.
