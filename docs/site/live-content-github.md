---
title: Live content from GitHub
description: Run Typren's git runtime tier with createGithubAdapter, cached reads, and a push webhook.
category: Guides
order: 23
---

`createGithubAdapter` (from `@typren/core`) reads content straight from a
repo over the GitHub Contents API, no checkout and no build-time copy. That
makes it a viable **git runtime**: a server-rendered site reads its content
live from GitHub at request time, as long as two things are wired up so a
page doesn't re-fetch GitHub on every request and a publish is still fast to
see.

## Two adapter instances

Use a separate `createGithubAdapter` instance for the site-render path and
for the editor. Only the site-render instance sets `readInit`.

```ts
import { createGithubAdapter } from "@typren/core";

// The SITE-RENDER instance: reads are cached and tagged.
const siteAdapter = createGithubAdapter({
  owner: "acme",
  repo: "site",
  token: ghToken,
  readInit: () => ({ cache: "force-cache", next: { tags: ["typren-content"] } }),
});

// The EDITOR's own instance: NEVER set readInit here. Draft reads must
// always be fresh — a cached draft would show a stale version of exactly
// the content someone is actively editing.
const editorAdapter = createGithubAdapter({ owner: "acme", repo: "site", token: ghToken });
```

`readInit` only ever applies to a read the adapter does on a caller's
behalf (`readRaw`, `listSlugs`, `exists`, ...). A write's own internal reads
(the sha lookup before a PUT, the `expectedVersion` re-GET) always bypass
it — CASing a write against a cached read would defeat the point of CAS.

## Caching reads

`cache: "force-cache"` opts into the platform's fetch cache at all (Next's
default for a `fetch` call varies by context); `next.tags` is what the
webhook/`onPublish` invalidation below targets.

## Invalidating both directions

Invalidate from both directions: a push to GitHub (someone edited content
outside the CMS, or a redeploy landed) via the webhook handler below, and the
editor's own publish, immediately, via `CmsConfig.onPublish` — without the
second one, your own publish click would sit behind the push webhook's round
trip before it's visible.

```ts
// app/api/github-webhook/route.ts
import { revalidateTag } from "next/cache";
import { createGithubWebhookHandler } from "@typren/core/github-webhook";

export const POST = createGithubWebhookHandler({
  secret: process.env.GITHUB_WEBHOOK_SECRET!,
  branch: "main",
  // `change.paths` is every path the push actually touched: a host that
  // tags reads per-path/per-slug can invalidate just those instead of
  // everything. Fall back to the one-tag form when `change.full` is true
  // (a force push or an unenumerable payload): there is nothing more
  // specific to invalidate.
  onChange: async (change) => {
    if (change.full) return revalidateTag("typren-content");
    for (const slug of change.slugs) revalidateTag(`typren-content:${slug}`);
  },
});
```

```ts
// cms.config.ts
export const cmsConfig: CmsConfig = {
  // ...
  adapter: editorAdapter,
  onPublish: async (slug) => revalidateTag(`typren-content:${slug}`), // same tag scheme, same cache
};
```

Configure the webhook in the GitHub repo's settings: content type
`application/json`, the same secret, `push` events only. A draft-only push
never calls `onChange` — draft reads are never cached, so there is nothing to
invalidate. A force push, or a push whose payload carries no commit list,
calls `onChange` with `full: true` and empty `paths`; a host doing per-slug
invalidation must then invalidate everything (the single-tag example above
already does).

## Drafts live on their own branch

`draftBranch` defaults to `"typren-drafts"`: every draft read, write,
delete, and `hasDraft` call targets that branch instead of `branch`, so
saving a draft never lands a commit on the branch your host builds from — no
triggered preview/production deploy, no draft noise in `branch`'s own
history. The branch is created lazily, from `branch`'s current HEAD, the
first time a draft is ever saved; a site that never saves a draft never gets
one.

Pass `draftBranch: null` (or the same value as `branch`) to keep the pre-0.5
layout instead: drafts under `draftSubdir` on `branch` itself, no second
branch.

> **Security:** a host whose platform builds every branch (Vercel's
> per-branch previews, Cloudflare Pages' branch deploys) must tell it to skip
> `typren-drafts`, or every draft save triggers a wasted deploy. See
> [Deploy to Vercel](./deploy-vercel.md#skip-builds-for-the-drafts-branch) for
> the Ignored Build Step snippet. Never set `readInit` on the editor's own
> adapter instance — a cached draft read would show a stale version of
> exactly the content someone is actively editing.

## Rate limits and listing caps

> **Cost:** every uncached read is a GitHub Contents API call, subject to
> GitHub's standard rate limits (5,000 requests/hour for an authenticated
> request, plus GitHub's secondary rate limits on burst traffic). Cache reads
> with `readInit` so an anonymous visitor's page load doesn't cost a GitHub
> API call per request. Listing a page directory goes through the Contents
> API's directory-listing endpoint, which caps at 1,000 entries;
> `listSlugs`'s own `ponytail:` comment names the Git Trees API
> (`/git/trees/<branch>?recursive=1`) as the upgrade path for a site with
> more pages than that — not implemented today.

## Options reference

| Option | Default | Notes |
|---|---|---|
| `owner`, `repo` | — | required |
| `token` | — | required; an installation access token, minted/refreshed by the caller |
| `branch` | `"main"` | every published read/write targets this branch |
| `draftBranch` | `"typren-drafts"` | `null` keeps drafts on `branch` under `draftSubdir` |
| `contentDir` | `"content"` | repo-relative directory page files live under |
| `mediaDir` | `"public/img"` | repo-relative media directory (validated, not yet written to) |
| `frontmatterKey` | `"slices"` | frontmatter key holding the slice array |
| `locales` | `[defaultLocale]` | locale allowlist |
| `defaultLocale` | `"en"` | served flat, unprefixed |
| `draftSubdir` | `"_drafts"` | note: not the fs adapter's `.drafts` — a dot-prefixed name would reject itself under this adapter's own write-path guard |
| `fetchImpl` | global `fetch` | injectable for tests |
| `readInit` | — | merged into every GET's `RequestInit`; content reads only, never writes |

Writes are serialized per adapter instance (one at a time), and `writeRaw`/
`writeDraftRaw` accept `opts.expectedVersion` for the store's optimistic
lock — see [Drafts and publishing](./drafts-and-publishing.md).
