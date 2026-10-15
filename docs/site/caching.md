---
title: Caching
description: readInit cache tags, webhook-driven invalidation, and what must never be cached.
category: Operations
order: 71
---

Caching only applies to a network-backed, read-heavy `ContentAdapter`
(`createGithubAdapter`). The filesystem adapter has nothing to cache (local
disk reads), and Notion's adapter has no cache hook today.

## `readInit`: tagging content reads

```ts
import { createGithubAdapter } from "@typren/core";

const adapter = createGithubAdapter({
  owner: "acme",
  repo: "site",
  token: githubInstallationToken,
  readInit: () => ({ next: { tags: ["typren-content"] } }),
});
```

`readInit(relPath)` is merged into every **read** request's `RequestInit` —
content GETs only, never writes. It is the hook for a host's own
fetch-cache options, most commonly Next's `{ next: { tags: [...] } }`, so a
push webhook can later invalidate exactly what this adapter cached.

For per-path invalidation granularity instead of one site-wide tag, use the
`relPath` argument already passed to the hook:

```ts
readInit: (relPath) => ({ next: { tags: [`typren-content:${relPath}`] } }),
```

> **Never set `readInit` on the editor's own adapter instance.** Draft reads
> must always be fresh — a cached draft read would show a stale version of
> exactly the content someone is actively editing. Build two adapter
> instances when a host needs both: one for site rendering (with
> `readInit`), one for the editor (without).

## Invalidating on push: the GitHub webhook

```ts
import { createGithubWebhookHandler } from "@typren/core/github-webhook";
import { revalidateTag } from "next/cache";

export const POST = createGithubWebhookHandler({
  secret: process.env.GITHUB_WEBHOOK_SECRET!,
  branch: "main",
  onChange: async (change) => {
    if (change.full) {
      revalidateTag("typren-content");
      return;
    }
    for (const path of change.paths) revalidateTag(`typren-content:${path}`);
  },
});
```

The handler verifies `X-Hub-Signature-256` over the raw body (HMAC,
constant-time compare) before anything else runs, dedupes redelivered
webhooks by `X-GitHub-Delivery` (per handler instance, so a redelivery
landing on a *different* instance in a multi-instance deploy still
processes — idempotent, just wasted work), and caps the body read at 5 MB,
streamed.

### `full: true`

`change.full` is `true` — meaning `paths`/`slugs`/`locales` are empty and the
host must invalidate **all** Typren content — on:

- a force push (history was rewritten; the commit list can't describe what
  actually changed),
- an empty commit list in the payload,
- a commit list at or above GitHub's own per-push cap (2,048 commits — the
  payload is truncated, more commits existed than are listed).

A draft-only push (every changed path under the draft subdirectory) fires no
`onChange` at all — draft reads are never cached, so there is nothing to
invalidate.

## What never gets cached

- **The editor's adapter instance** (see above) — draft reads must be live.
- **Any `/api/*` route in `@typren/core/api`** — every request re-resolves
  auth and re-reads current state; these are mutation/admin surfaces, not
  cacheable content.
- **`currentVersion`/optimistic-lock reads** — a cached version would defeat
  the compare-and-swap the draft/publish flow depends on
  (see [drafts-and-publishing](./drafts-and-publishing.md)).

## What's safe to cache aggressively

- Published page reads through a tagged `readInit` (above).
- `buildSitemap`/`buildRobots`/`generateLlmsFullTxt` output, if built at
  request time rather than statically — these fan out over every page in the
  store (see [cost-and-rate-limits](./cost-and-rate-limits.md)), so serving
  them from a build artifact or a long-TTL cache instead of per-request is
  the difference between one full-site scan per deploy and one per visitor.
- Media URLs from `adapter-media-s3`: uploaded keys carry a random suffix and
  are never overwritten, so they're served with an immutable,
  one-year `cache-control` by the adapter itself — no separate invalidation
  path is needed for media.
