---
"@typren/core": minor
---

BREAKING: `ContentAdapter` and `ContentStore` are now fully async (issue #29),
`ContentAdapter.root` was removed from the interface in favor of the exported
`MarkdownAdapter` type, and the Notion adapter's `spawnSync` bridge is gone in
favor of a plain `fetch`. See
[`docs/migrations/core-0.5.0.md`](../docs/migrations/core-0.5.0.md) for the
fix-up steps, or run `npx typren migrate` once it ships.

Also new: `createGithubAdapter`'s `readInit` option for host-cache-tagged
content reads, and `@typren/core/github-webhook` for invalidating that cache
on a GitHub push (issue #29's "git runtime").
