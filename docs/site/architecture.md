---
title: Architecture
description: The four layers content moves through, and which one owns what.
category: Concepts
order: 10
---

Typren is built as four layers, each depending only on the one below it:

```
ContentAdapter    storage: fs + markdown, GitHub, or your own
      ↓
ContentStore      draft/publish, locale fallback, version-checked writes
      ↓
makeActions()     auth-gated handlers
      ↓
studio UI         React, mounted by a thin host
```

`MediaAdapter` and `AuthAdapter` follow the same shape alongside
`ContentAdapter`: an interface plus one or more `create*Adapter(opts)`
factories. Swapping storage, media, or auth never touches the layers above
it.

## ContentAdapter

The only thing that knows where and how content is stored and serialized.
Defined in `@typren/core`'s `types.ts`, it's a plain interface:
`listSlugs`, `listLocales`, `exists`, `readRaw`/`writeRaw`,
`readDraftRaw`/`writeDraftRaw`/`deleteDraft`/`hasDraft`, `deletePublished`,
and the pure, synchronous `parse`/`serialize` pair that round-trips a raw
file to a `PageContent` (`{ meta, slices, body }`) and back.

Every method is `async`, even ones that don't need to be: a uniform
"always returns a promise, never throws synchronously" contract is what lets
callers reliably `await adapter.writeRaw(...)`.

Two adapters ship today: `createMarkdownAdapter` (filesystem + gray-matter)
and `createGithubAdapter` (GitHub Contents API). See
[Content tiers](./content-tiers.md) for the trade-offs between them, and
[Collections and Notion](./collections-and-notion.md) for a third,
`createNotionAdapter`.

**Trust boundaries live inside the adapter, not above it.** Slug and locale
validation (a `SAFE_SLUG` regex, a locale allowlist check) run inside
`createMarkdownAdapter`/`createGithubAdapter` themselves; a caller higher up
the stack never re-validates and must never assume it already has been. See
[Security model](./security-model.md).

## ContentStore

Storage-agnostic read/draft/publish operations layered over any
`ContentAdapter`, created with `createStore(adapter, opts)`. This is where
draft-vs-published state, default-locale fallback, and optimistic-lock
version checks live — logic no individual adapter needs to repeat.
`listPages`, `getPublished`, `getDraft`, `saveDraft`, `publish`,
`createPage`, `createTranslation`, `deletePage`, `renamePage`,
`duplicatePage` all live on `ContentStore`. See
[Drafts and publishing](./drafts-and-publishing.md) for how `saveDraft` and
`publish` behave under concurrent edits.

Fan-out operations that loop over every slug in a site (`listPages`, SEO
builders) are capped at 8 concurrent adapter calls (`mapLimit`), bounding
how hard a full-site scan hits a rate-limited GitHub or Notion adapter.

## makeActions()

Wraps a `ContentStore` with the auth-gated handlers a host's Server Actions
or API routes call: `saveDraft`, `discardDraft`, `publish`, `createPage`,
`createTranslation`, `deletePage`, `deleteTranslation`, `listMedia`,
`deleteMedia`, and more. Every handler re-resolves `authorize()` through
`resolveAuth(config)` before doing anything, because a Server Action is a
public POST endpoint — the gate can't live in a parent layout alone, since a
Route Handler (e.g. the media upload route) renders no layout tree at all.
See [Auth model](./auth-model.md).

The site itself exposes none of these. [`typren studio`](./studio.md) serves
them from its own process, over `createTyprenApi`, and the site only reads.

## studio UI

`@typren/studio` — the React components (`TyprenStudio` and its pieces:
`BlockList`, `FieldForm`, `DevicePreview`, the Media/Settings/Collection
panels, media and icon pickers) that call into `makeActions()`'s handlers. It depends on
`@typren/core` for everything below this layer and owns nothing
server-side itself.

Studio local runs in `apps/studio`, a thin Next.js host that
[`typren studio`](./studio.md) starts beside your site. It frames the site's
own pages as the live preview, so the site mounts no studio route. Studio
cloud, the hosted dashboard, is the second host of the same package.

> **Status:** `@typren/studio` and `@typren/studio-local` are still `private: true`
> and not published to npm.

A non-React host can still mount a built studio through the `./element`
subpath (`<typren-shell>`, a custom element wrapping `TyprenStudio`), without
pulling React into its own app shell beyond what the element needs internally.
