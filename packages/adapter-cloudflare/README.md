# @typren/adapter-cloudflare

Cloudflare Workers + Static Assets host adapter for typren's
[`redirects()`](../core#readme) (page frontmatter `aliases: string[]`). Ships
the canonical Worker for a static-export site, and a CLI that writes the
wrangler config, bootstraps a Workers KV namespace, and diff-syncs the
redirect map into it.

**Not IaC.** This package never creates a zone, account or DNS record beyond
what `wrangler` itself manages for a Worker + custom domain. It's the thin,
differentiated layer on top of a Cloudflare account you already have.

## Quick start

```bash
npm i -D @typren/adapter-cloudflare wrangler
npx typren-cloudflare init --name my-site --domain example.com
next build
npx typren-cloudflare bootstrap
```

`init` writes `wrangler.jsonc`. `bootstrap` creates the `REDIRECTS` KV
namespace (first run only), syncs redirects into it, and deploys. Re-run
`bootstrap` after every build; it's idempotent.

## How routing works

A Worker runs first on every request except `/_next/*`
(`run_worker_first: ["/*", "!/_next/*"]` in the generated config — those
paths are content-hashed and never need a redirect or the directory-index
rewrite, so skipping the Worker for them is a latency win). The Worker calls
`@typren/core`'s `resolveStaticHostRequest` and turns its decision into:

- **redirect** → a 301 response.
- **rewrite** → `env.ASSETS.fetch()` against the canonical object path (the
  directory-index rewrite an S3-shaped static export needs: `/about/` has no
  index-document behaviour on its own, it asks for `about/index.html`).
- **pass** → `env.ASSETS.fetch(request)` unchanged.

Native Cloudflare trailing-slash handling is **off**
(`html_handling: "none"`): the Worker owns canonicalization so it matches
`@typren/core`'s semantics exactly (301s, query string preserved), which
CF's own `html_handling` modes don't attempt. `not_found_handling:
"404-page"` serves the static export's own `404.html`.

If the `REDIRECTS` KV binding is missing entirely (a site deployed before
`bootstrap` has run), the lookup degrades to "no redirect" and the site still
serves — only the redirect feature is unavailable until `bootstrap` runs.

## Redirects

Two mergeable sources, same as `@typren/adapter-cloudfront`:
`@typren/core`'s `redirects()` (page frontmatter `aliases:`) and an optional
`--map` file (`.json`, or `.mjs`/`.js` exporting `{ from, to }[]`) for
everything that isn't a property of a page that exists — legacy platform
URLs, removed pages, paths that moved off-site entirely.

```bash
npx typren-cloudflare sync-redirects
npx typren-cloudflare sync-redirects --map redirects.config.mjs
npx typren-cloudflare sync-redirects --dry-run
```

A bare-URL-canonical site (Next's `trailingSlash: false`) should pass
`--trailing-slash false`, which emits map targets verbatim instead of
slash-canonicalized. An empty desired state refuses to delete every live key
unless you pass `--allow-empty`.

## Trust boundaries

- **An `.mjs`/`.js` map file is code and runs when loaded.** A CI job that
  runs `sync-redirects --map something.mjs` on freshly merged, lightly
  reviewed changes executes those changes with the job's Cloudflare
  credentials. Use the `.json` form there, or require review on map changes.
- **KV write access to the `REDIRECTS` namespace is the real control.**
  Whoever holds it controls where this site's redirects point. The Worker
  refuses the worst classes written around this CLI (protocol-relative,
  backslash, control characters), but scoping that access tightly is what
  actually protects the site.
- **Browsers cache 301s indefinitely.** A wrong redirect that shipped is
  sticky in visitors' browsers even after the store is fixed, `--dry-run`
  before syncing to production is cheap insurance.

## Cost

Every request that doesn't match `/_next/*` invokes the Worker. Cloudflare's
free plan includes 100,000 Worker requests/day; a paid plan is needed beyond
that for a Worker this central to every page load.

## Redirect propagation

A `sync-redirects` write lands in Workers KV's primary store immediately, but
KV's own edge cache can take up to ~60 seconds to catch up everywhere, so a
redirect may not be instantly live at every PoP. There's still no CloudFront-
style function deploy or invalidation needed.

## Custom domains

`init --domain <host>` writes a `routes` entry with `custom_domain: true`;
`bootstrap`'s `wrangler deploy` then provisions the DNS record and
certificate. The zone must already be active on the same Cloudflare account,
and the hostname must have no existing conflicting DNS record (a wildcard
domain is not supported here, pass a bare hostname per `--domain`).

## Scope and operational notes

- **Exact-path redirect matches only**, same as the CloudFront adapter: no
  wildcards. Migrating a wildcard-style redirect file means enumerating the
  real paths.
- **`bootstrap` only ever touches the `REDIRECTS` KV binding and the Worker's
  own deploy.** It doesn't manage any other binding, route or setting your
  `wrangler.jsonc` carries, hand-edit or re-run `init --force` for that.
- **This package never calls the Cloudflare API directly.** Every operation
  shells out to `wrangler`, the user's own install (`wrangler login` or
  `CLOUDFLARE_API_TOKEN` both work), via `npx`, so authentication is
  whatever `wrangler` already has configured. No AWS/Cloudflare SDK is a
  dependency of this package.

## Testing without a real Cloudflare account

Every Cloudflare-touching operation is injected (`KvClient` in `src/types.ts`,
plus `createNamespace`/`deploy` functions for the CLI's `bootstrap` command):
the diff logic (`sync.ts`) and the CLI dispatch (`cli.ts`) are unit-tested
against fakes, no account needed. `createWranglerKvClient()` (the CLI's
default) shells out to `wrangler kv` rather than adding a Cloudflare SDK as a
dependency, same approach as `@typren/adapter-cloudfront`'s
`createAwsCliKvsClient()`; swap in your own client behind the same interface
if you need something else.
