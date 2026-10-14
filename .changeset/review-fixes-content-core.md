---
"@typren/core": minor
---

Fix a GitHub-backed site's markdown mirror route listing every page on each
request instead of checking one slug's existence, bound the concurrent
fan-out `listPages`/sitemap/llms.txt/redirects open over a site's slugs, give
`createGithubAdapter` a real optimistic-lock upgrade path
(`ContentAdapter.writeRaw`/`writeDraftRaw` now take an optional
`opts.expectedVersion`), and serialize its writes so concurrent per-locale
deletes can't race each other's cached blob sha.

`createGithubAdapter` also gains `draftBranch`, defaulting to
`"typren-drafts"`: drafts now live on their own branch by default instead of
the published branch, created lazily on first draft save. Pass
`draftBranch: null` to keep the previous single-branch layout. See
docs/migrations/core-0.5.0.md.
