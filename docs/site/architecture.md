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
editor UI         React, mounted by a thin host
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

`typren init`'s scaffolded `cms-actions.ts` is a thin, host-owned
`"use server"` wrapper around `makeActions(cmsConfig)` — the package supplies
the logic, the host owns the `"use server"` boundary.

## editor UI

`@typren/editor` — the React components (`TyprenEditor` and its pieces:
`EditorShell`, `PagesNav`, `BlockList`, `FieldForm`, `DevicePreview`, media
and icon pickers) that call into `makeActions()`'s handlers. It depends on
`@typren/core` for everything below this layer and owns nothing
server-side itself.

> **Status:** `@typren/editor` is still `private: true` and not published to
> npm. The current `typren init` scaffold wires the content layer only and
> emits no editor route; install `@typren/editor` once it ships if you want a
> UI on top of the slices and server actions `init` already wrote.

A non-React host can still mount a built editor through the `./element`
subpath (`<typren-shell>`, a custom element wrapping `TyprenEditor`), without
pulling React into its own app shell beyond what the element needs internally.
