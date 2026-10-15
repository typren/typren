# @typren/adapter-cloudflare

Cloudflare Workers + Static Assets host adapter for typren's
[`redirects()`](../core#readme) (page frontmatter `aliases: string[]`). Ships
the canonical Worker for a static-export site, and a CLI that writes the
wrangler config, bootstraps a Workers KV namespace, and diff-syncs the
redirect map into it.

**Not IaC.** This package never creates a zone, account or DNS record beyond
what `wrangler` itself manages for a Worker + custom domain.

## Install

```bash
npm i -D @typren/adapter-cloudflare wrangler
```

## Quick start

```bash
npx typren-cloudflare init --name my-site --domain example.com --domain www.example.com --canonical-host www.example.com
next build
npx typren-cloudflare bootstrap
```

`init` writes `wrangler.jsonc`. `bootstrap` creates the `REDIRECTS` KV
namespace (first run only), syncs redirects into it, and deploys. Re-run
`bootstrap` after every build; it's idempotent.

> **Security:** an `.mjs`/`.js` `--map` file passed to `sync-redirects` is code and runs
> when loaded; a CI job executing it on freshly merged changes runs it with the job's
> Cloudflare credentials. Use the `.json` map form in CI, or require review on map changes.

> **Cost:** every request not matching `/_next/*` invokes the Worker. Cloudflare's free
> plan includes 100,000 Worker requests/day.

See the [full reference](https://github.com/typren/typren/blob/develop/docs/site/reference-adapter-cloudflare.md)
for every export, CLI flag and error, and [deploy-cloudflare](https://github.com/typren/typren/blob/develop/docs/site/deploy-cloudflare.md)
for the end-to-end walkthrough.

## License

Apache-2.0 — see [LICENSE](./LICENSE). It depends on `@typren/core`, which is
under the [Functional Source License](https://github.com/typren/typren/blob/main/LICENSE).
