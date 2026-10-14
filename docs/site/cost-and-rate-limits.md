---
title: Cost and rate limits
description: Concrete adapter call counts per operation, provider rate limits, and known ceilings.
category: Operations
order: 70
---

This page gives per-operation call counts against the network-backed
adapters (`createGithubAdapter`, the Notion adapter, `adapter-media-s3`), the
concurrency cap every fan-out obeys, and the provider rate limits those call
counts run against. Verify against the code on your branch — these numbers
come from reading `store.ts`, `github-adapter.ts`, `notion-adapter.ts` and
`s3-media-adapter.ts` directly.

## Fan-out concurrency: 8

Every `ContentStore`/SEO operation that loops over every slug (or
slug × locale) in a site — `listPages`, `buildSitemap`, `buildRedirects`,
`generateLlmsFullTxt`, `listCollectionRecords` — uses `mapLimit(items, 8, fn)`
(`packages/core/src/concurrency.ts`): at most 8 adapter calls in flight at
once, regardless of site size. A 500-page site does the same number of
*total* calls as a 10-page site, just spread over more batches — this bounds
concurrency, not total call count.

## GitHub adapter (`createGithubAdapter`) call counts

Each bullet is one `ContentStore` operation and the GitHub Contents API calls
it makes. "GET"/"PUT"/"DELETE" are HTTP verbs against
`/repos/:owner/:repo/contents/:path`.

| `ContentStore` call | GitHub API calls |
|---|---|
| `listSlugs(locale)` | 1 GET (directory listing) |
| `getPublished(slug, defaultLocale)` | 1 GET |
| `getPublished(slug, otherLocale)`, no translation | 2 GET (default-locale read + locale `exists` check) |
| `getPublished(slug, otherLocale)`, translation exists | 3 GET (default-locale read + `exists` + locale read) |
| `exists(slug, locale)` | 1 GET |
| `listPages(locale)` | 1 GET (listSlugs) + per page, fanned out at 8: 1 GET (readRaw) + 1 GET (hasDraft) + 1 GET per configured locale (listLocales) |
| `saveDraft(slug, page, baseVersion)` | 1 GET (version check: readDraftRaw) + 1 PUT (write), +1 GET if the sha cache is cold for the draft path |
| `publish(slug, baseVersion)` | 1 GET (readDraftRaw) + 1 PUT (publish write, +1 GET if the published path's sha isn't cached) + 1 DELETE (remove draft, usually cache-warm from the GET above) |
| `createPage(slug, page)` | 1 GET (`exists` check) + 1 PUT |
| `renamePage(slug, newSlug)` | per locale: 1 GET (collision check) upfront for every locale, then up to 1 GET + 1 PUT + 1 DELETE (published) and 1 GET + 1 PUT + 1 DELETE (draft) per locale that has content |
| `duplicatePage(slug)` | 2 GET (published + draft existence/read) + up to 1 GET per collision-probe slug, + 1 PUT (published) and/or 1 PUT (draft) |

Reads (`listSlugs`, `readRaw`, `exists`) run in parallel, capped by the
fan-out limit above. Writes to the **same adapter instance** are serialized
one at a time (`serializeWrite`) so two concurrent writes can't race the same
cached blob sha into a spurious conflict — this does not throttle writes
across different paths/slugs any further than one-at-a-time.

### GitHub's own limits

> **Cost:** a GitHub App installation token is rate-limited to **5,000
> requests/hour**, shared across every read and write this adapter makes for
> that installation. GitHub also enforces **secondary rate limits**
> (concurrent-request and content-creation limits) independent of the hourly
> quota — a burst of writes (e.g. publishing many pages back-to-back) can hit
> these before the hourly cap does. Space out bulk operations, and prefer
> `readInit`'s cache-tag hook over polling.

## Notion adapter call counts

| Operation | Notion API calls |
|---|---|
| `listSlugs()` | 1+ POST `/databases/:id/query` (paginated, 1 call per 100-row page) |
| `readRaw(slug)`, with `slugProperty` | 1 full `queryDatabase` scan (same pagination as above) to find the row, then (for `content: "blocks"`/`"slices"`) 1+ GET per block-tree level for `listBlockChildren` |
| `readRaw(slug)`, without `slugProperty` (slug = page UUID) | 1 GET `/pages/:id` (no scan) |
| `writeRaw`/`writeDraftRaw` | 1 lookup (scan or GET, as above) + 1 POST `/pages` (create) or 1 PATCH `/pages/:id` (update) |
| `deletePublished` | 1 lookup + 1 PATCH (archive) |

> **Cost:** Notion's API is rate-limited to roughly **3 requests/second**.
> Without `slugProperty`, every lookup is a page-id GET — cheap. **With**
> `slugProperty`, every lookup does a full, client-side `queryDatabase` scan
> (Notion's filter JSON is property-type-specific; this adapter doesn't build
> one), so one write per slug in a loop starts throttling on request rate
> well before the O(n) scan itself is the bottleneck. Fine for admin-table
> collections; memoize `queryDatabase` per store operation, or add a filtered
> query, before a collection grows into the thousands of rows.

## S3-compatible media adapter (R2 / Supabase / AWS / MinIO)

`list()` does a full `ListObjectsV2` scan of the configured prefix, every
time the media library is opened — there is no caching and no cursor/limit
parameter on `MediaAdapter.list()` itself. Pagination is capped at **100
pages** (1,000 keys per page, so up to ~100,000 objects); beyond that it
throws rather than silently truncating. `upload()` is 1 PUT; `delete()` is 1
DELETE (idempotent on a missing key).

## What an anonymous visitor can and cannot trigger

Every mutation in `makeActions`/`createSettingsStore` (`saveDraft`,
`publish`, `createPage`, `renamePage`, `deletePage`, media upload/delete,
settings writes) calls `AuthAdapter.authorize()` first and throws
`"typren: unauthorized"` on denial. `@typren/core/api`'s HTTP routes gate
**reads too** (a bare GET never reaches an action guard otherwise), so the
entire `/api/*` surface requires `authorize({ action: "read" | ... })` to
return true.

An anonymous visitor **can** trigger, without any auth:

- A public page render (`getPublished`, 1–3 GitHub reads per page per
  request unless the host caches via `readInit`'s fetch tags).
- The markdown mirror (`/<slug>.md`) and, if routed dynamically rather than
  pre-built, `llms-full.txt` — the latter is a **full-site fan-out**
  (`generateLlmsFullTxt` reads every published page), so serving it
  per-request rather than at build time multiplies read cost by request
  volume. Build it once and cache/serve it statically.
- A form submission (`createFormHandler`'s `POST`) — rate-limited only by
  the honeypot and an optional `spamVerifier`; each submission fans out to
  every configured sink.
- A POST to the GitHub webhook route — HMAC-verified
  (`X-Hub-Signature-256`) before anything else runs; an invalid signature
  401s after a capped (5 MB, streamed) body read, so an unauthenticated
  flood costs a bounded read and a signature check, never a store call.

An anonymous visitor **cannot** trigger any draft save, publish, page
create/rename/delete, media upload/delete, or settings write — every one of
those is behind `authorize()`, which fails closed on a thrown error (see
[security-checklist](./security-checklist.md)).

## Known ceilings

- **GitHub Contents API directory listing caps at 1,000 entries**, with no
  pagination support on that endpoint. `listSlugs`/`listPages` use it as-is;
  a Pages directory beyond that count needs the Git Trees API
  (`GET /git/trees/:branch?recursive=1`, one paginated call for the whole
  tree) instead — not implemented today.
- **S3 media listing caps at 100 pages** (~100,000 objects); `MediaAdapter`
  has no list cursor/limit parameter yet, so a library past that size needs
  adapter changes, not just configuration.
- **Notion's API has no native way to express an arbitrary property filter
  generically** from this adapter's config shape, so `slugProperty` lookups
  are an O(n) scan, not an O(1) query (see above).
