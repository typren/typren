# @typren/adapter-cloudfront

CloudFront host adapter for typren's [`redirects()`](../core#readme) (page
frontmatter `aliases: string[]`). Ships the canonical viewer-request function
for a static-export site on an S3 REST origin, and a CLI that diff-syncs the
redirect map into a CloudFront KeyValueStore.

**Not IaC.** This package never creates a bucket or a distribution — that's
Terraform/CDK/SST territory.

## Install

```bash
npm i -D @typren/adapter-cloudfront
```

## Quick start

```bash
npx typren-cloudfront bootstrap --distribution-id E1234567890ABC
npx typren-cloudfront sync-redirects --store my-site-redirects
```

`bootstrap` is a one-time, guarded setup on a distribution that already
exists: it creates the KeyValueStore if needed, publishes the canonical
function, and attaches it to the default cache behavior. It refuses to
replace a *different* already-attached function unless you pass `--force`
(a blind replace has taken down a real site before — see the reference page).
`sync-redirects` is idempotent; re-run it whenever redirects change.

> **Security:** an `.mjs`/`.js` `--map` file passed to `sync-redirects` is code and runs
> when loaded; a CI job executing it on freshly merged changes runs it with the job's AWS
> credentials. Use the `.json` map form in CI, or require review on map changes.

> **Cost:** a redirect change needs no CloudFront invalidation; the function reads the
> KeyValueStore at request time.

See the [full reference](https://github.com/typren/typren/blob/develop/docs/site/reference-adapter-cloudfront.md)
for every export, CLI flag, required IAM action and error, and
[deploy-cloudfront](https://github.com/typren/typren/blob/develop/docs/site/deploy-cloudfront.md)
for the end-to-end walkthrough.

## License

Apache-2.0 — see [LICENSE](./LICENSE). It depends on `@typren/core`, which is
under the [Functional Source License](https://github.com/typren/typren/blob/main/LICENSE).
