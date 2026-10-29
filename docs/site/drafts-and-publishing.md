---
title: Drafts and publishing
description: Draft vs. published state, optimistic locking, and the publish flow.
category: Concepts
order: 12
---

Every page has two possible states per locale: a **draft** (unpublished
changes) and the **published** version your site actually renders. Both are
tracked by the `ContentAdapter` (see [Architecture](./architecture.md)); the
`ContentStore` built on top of it is what composes them into a single
save/publish flow.

## Reading

`ContentStore.currentVersion(slug, locale)` returns the version of whatever
the studio would load: the draft if one exists, else the published content,
else `null` if the slug has no content at all in that locale. "Version" is a
content hash (`versionOf`, a truncated SHA-256 of the raw file text) — not a
counter or a timestamp, so it survives moving the same content between
adapters.

## Saving a draft

```ts
const version = await cmsStore.saveDraft(slug, page, baseVersion, locale);
```

`page` is a `PageContent` (`{ meta, slices, body }`). `baseVersion` is
optional: when you pass it, `saveDraft` compares it against the version the
store would currently return and throws `ConflictError` if they differ —
an optimistic lock, so a save can't silently clobber someone else's
more-recent edit. Omit it and the write is unconditional.

The optimistic lock is enforced twice for adapters that support it:

1. A pre-check in `ContentStore` itself, read-then-compare (there's a TOCTOU
   window here on its own — acceptable for a single-node filesystem adapter,
   which has nothing else to race against).
2. `baseVersion` is also passed through as the adapter's own
   `writeDraftRaw(..., { expectedVersion })`. `createGithubAdapter` turns this
   into a real compare-and-swap against GitHub's own blob `sha`, closing the
   window the pre-check alone can't. `createMarkdownAdapter` has no atomic
   primitive to hang this on and ignores `opts`, keeping its existing
   unconditional-overwrite behavior.

## Publishing

```ts
await cmsStore.publish(slug, baseVersion, locale);
```

Reads the current draft, optionally checks `baseVersion` the same way as
`saveDraft` (`ConflictError` on a stale version), writes it to the published
location via `adapter.writeRaw`, deletes the draft, then runs the optional
`onPublish(slug, locale)` hook from `CmsConfig`. If there's no draft,
`publish` is a no-op — it never rewrites the published file for nothing.

`onPublish` is for side effects: `revalidatePath`/`revalidateTag` on the
host, or a GitHub commit in a hosted setup. There's a parallel
`onSaveDraft(slug, locale, version)` hook fired synchronously right after a
draft write, meant for something fast (a marker-file write), not a network
call — `saveDraft` does not await it.

## Where drafts live

- **`createMarkdownAdapter`**: under `<contentDir>/.drafts/<slug>.md` for
  the default locale, `<contentDir>/<locale>/.drafts/<slug>.md` otherwise.
  Configurable via `draftDir`/`draftSubdir`.
- **`createGithubAdapter`**: by default on a separate `typren-drafts` branch
  (`draftBranch`), auto-created from `branch`'s current HEAD the first time a
  draft write needs it — a site never gets the extra branch until someone
  actually saves a draft. Pass `draftBranch: null` to opt back into the
  legacy layout: drafts under a `_drafts/` subdirectory on `branch` itself.
  Isolating drafts onto their own branch means a draft save never lands a
  commit on the branch your site builds and deploys from, so it can't
  trigger (or pollute) a production/preview deploy. A host that builds every
  branch (Vercel preview deployments, Cloudflare Pages branch builds) should
  tell it to ignore `typren-drafts` — see
  [Live content from GitHub](./live-content-github.md).

## Other store operations

- **`discardDraft(slug, locale)`** — deletes the draft, no publish.
- **`createPage(slug, page, locale, opts)`** — creates new *published* content
  directly, or with `opts.draft` a draft only, which lists with
  `published: false` until its first publish; throws if the slug already has
  content or a draft in that locale.
- **`createTranslation(slug, fromLocale, toLocale)`** — seeds a *draft*
  translation by copying `fromLocale`'s content; no-op if `toLocale` already
  has published content or a draft.
- **`renamePage`** / **`duplicatePage`** — move or clone a page's published
  and draft content together across every locale (rename) or one locale
  (duplicate), so an in-progress draft is never silently dropped.

`ConflictError` (and the `SlugExistsError` a rename/duplicate collision
throws) both carry `code: "conflict"`, so the action layer and HTTP API map
them to a 409 without inspecting error messages.
