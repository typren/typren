---
title: Content tiers
description: Git static, git runtime, and SQL — the three ways content can be stored.
category: Concepts
order: 11
---

A `ContentAdapter` is the only thing that knows where content lives (see
[Architecture](./architecture.md)). Typren ships two working tiers today, and
anticipates a third.

## Git static (default)

`createMarkdownAdapter`, backed by `node:fs` and `gray-matter`. Content is
`.md` files in your repo; a publish is a filesystem write, picked up at the
next build. This is what `typren init` scaffolds.

- **Reads**: local filesystem, no network call, no rate limit.
- **Writes**: immediate, unconditional overwrite — no compare-and-swap, since
  there's nothing to race against on a single-node fs.
- **Deploy model**: content changes land through your normal build/deploy
  pipeline (a commit triggers a rebuild).
- **Cost**: free — no external API calls at all.

## Git runtime (GitHub + webhook)

`createGithubAdapter`, backed by GitHub's Contents API. Content still lives
as `.md` files in a repo, but reads and writes happen live over the network
instead of through the local filesystem, so a save can update a running site
without a rebuild.

- **Reads**: one GitHub API call per file (or per directory listing). Can
  carry a host's own cache hint via `readInit` (e.g. Next's
  `{ next: { tags: [...] } }`) for published reads; never cached for drafts.
- **Writes**: a real compare-and-swap — every write reads the file's current
  blob `sha` and GitHub rejects the PUT if it's stale, closing the race a
  filesystem write can't detect. Writes to the same path are serialized
  per adapter instance so two concurrent writes can't race the same cached
  `sha`.
- **Drafts**: by default isolated on a separate `typren-drafts` branch (see
  [Drafts and publishing](./drafts-and-publishing.md)), so a draft save never
  lands a commit on the branch your site builds from.
- **Invalidation**: a push webhook (`@typren/core/github-webhook`) tells the
  host which paths/slugs/locales changed, HMAC-verified against
  `X-Hub-Signature-256`.
- **Cost**: GitHub's REST rate limits apply (5,000 requests/hour for a GitHub
  App installation token, plus secondary limits on write bursts). See
  [Cost and rate limits](./cost-and-rate-limits.md) for the call counts per
  operation.
- **Ceiling**: directory listing (`listSlugs`) uses the Contents API, capped
  at 1,000 entries with no pagination; a site with more pages per locale
  needs the Git Trees API instead (not implemented).

See [Live content from GitHub](./live-content-github.md) for wiring this up
end-to-end.

## SQL (future, not built)

A database-backed `ContentAdapter` — content rows in Postgres/SQLite instead
of files — is anticipated by the adapter interface's shape (any storage that
can implement `listSlugs`/`readRaw`/`writeRaw`/etc. plugs in identically) but
no such adapter ships yet. If you need this today, implement `ContentAdapter`
yourself; see [Writing an adapter](./writing-an-adapter.md).

## Choosing

| | Git static | Git runtime | SQL |
|---|---|---|---|
| Storage | fs `.md` files | GitHub-hosted `.md` files | database rows |
| Status | ships, default | ships | not built |
| Write latency | instant (local fs) | one network round trip | — |
| Publish triggers | next build | immediately, via webhook | — |
| Concurrent-write safety | none (unconditional overwrite) | real compare-and-swap | — |
| External cost | none | GitHub API rate limits | — |
| Best for | a single site, one deploy pipeline | live edits without a rebuild, multi-instance hosts | — |
