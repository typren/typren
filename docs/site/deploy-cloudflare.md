---
title: Deploy to Cloudflare
description: Serve a static-export Typren site from Cloudflare Workers with @typren/adapter-cloudflare.
category: Guides
order: 21
---

`@typren/adapter-cloudflare` is a Cloudflare Workers + Static Assets host
adapter for Typren's `redirects()` (page frontmatter `aliases: string[]`). It
ships the Worker that serves your static export and a CLI that writes the
`wrangler` config, bootstraps a Workers KV namespace, and syncs the redirect
map into it. It is not infrastructure-as-code: it never creates a zone,
account, or DNS record beyond what `wrangler` itself manages for a Worker and
its custom domain.

## Install and initialize

```bash
npm i -D @typren/adapter-cloudflare wrangler
npx typren-cloudflare init --name my-site --domain example.com --domain www.example.com --canonical-host www.example.com
next build
npx typren-cloudflare bootstrap
```

`init` writes `wrangler.jsonc`. `bootstrap` creates the `REDIRECTS` KV
namespace on its first run, syncs redirects into it, and deploys. Re-run
`bootstrap` after every build; it is idempotent.

## How routing works

A Worker runs first on every request except `/_next/*` (those paths are
content-hashed and never need a redirect or the directory-index rewrite). The
Worker calls `@typren/core`'s `resolveStaticHostRequest` and turns the
decision into a 301 redirect, an `env.ASSETS.fetch()` rewrite (the
directory-index rewrite a static export needs — `/about/` has no
index-document behavior on its own and asks for `about/index.html`), or a
pass-through fetch.

If the `REDIRECTS` KV binding is missing (a site deployed before `bootstrap`
has run), the lookup degrades to "no redirect" and the site still serves;
only the redirect feature is unavailable until `bootstrap` runs.

## URL shape and canonical host

`init` flags, all written into `wrangler.jsonc`:

| Flag | What it controls |
|---|---|
| `--trailing-slash false` | Next's default static-export shape: `/pricing` serves `pricing.html`, `/pricing/` redirects to `/pricing`. |
| `--canonical-host <host>` | 301s every other hostname (typically the apex) to this one, path and query preserved. |
| `--account-id <id>` | Pins the account when your `wrangler` login can see several. |

Omitting `--trailing-slash` assumes `trailingSlash: true` (`/pricing/` serves
`pricing/index.html`, `/pricing` redirects to `/pricing/`).

## Syncing redirects

```bash
npx typren-cloudflare sync-redirects
npx typren-cloudflare sync-redirects --map redirects.config.mjs
npx typren-cloudflare sync-redirects --dry-run
```

Redirects come from two mergeable sources: `@typren/core`'s `redirects()`
(page frontmatter `aliases:`) and an optional `--map` file (`.json`, or
`.mjs`/`.js` exporting `{ from, to }[]`) for legacy platform URLs, removed
pages, and anything else that isn't a property of a page that exists. An
empty desired state refuses to delete every live key unless you pass
`--allow-empty`.

> **Security:** an `.mjs`/`.js` map file is code and runs when loaded. A CI
> job that runs `sync-redirects --map something.mjs` on freshly merged,
> lightly reviewed changes executes those changes with the job's Cloudflare
> credentials. Use the `.json` form there, or require review on map changes.
> KV write access to the `REDIRECTS` namespace is the real control: whoever
> holds it controls where the site's redirects point.

## Custom domains

`init --domain <host>` writes a `routes` entry with `custom_domain: true`;
`bootstrap`'s `wrangler deploy` then provisions the DNS record and
certificate. The zone must already be active on the same Cloudflare account,
and the hostname must carry no conflicting DNS record (wildcard domains
aren't supported — pass a bare hostname per `--domain`).

## Scope

- Exact-path redirect matches only, same as `@typren/adapter-cloudfront`: no
  wildcards.
- `bootstrap` only ever touches the `REDIRECTS` KV binding and the Worker's
  own deploy. Hand-edit or re-run `init --force` for anything else in
  `wrangler.jsonc`.
- This package never calls the Cloudflare API directly; every operation
  shells out to your own `wrangler` install, authenticated however it
  already is.

> **Cost:** every request that doesn't match `/_next/*` invokes the Worker.
> Cloudflare's free plan includes 100,000 Worker requests/day; a paid plan is
> needed beyond that for a Worker this central to every page load. A KV write
> from `sync-redirects` lands immediately, but KV's edge cache can take up to
> ~60 seconds to catch up everywhere.
