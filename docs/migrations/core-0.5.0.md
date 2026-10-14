---
package: "@typren/core"
version: "0.5.0"
title: "ContentAdapter and ContentStore are async"
detect:
  - pattern: "\\b(cmsStore|store)\\.(listPages|getPublished|getDraft|currentVersion)\\("   # JS regex source
    glob: "**/*.{ts,tsx}"
    hint: "ContentStore reads now return Promises; add await."
  - pattern: "satisfies\\s+ContentAdapter\\b|:\\s*ContentAdapter\\b"
    glob: "**/*.{ts,tsx}"
    hint: "A custom ContentAdapter's I/O methods (listSlugs, listLocales, exists, readRaw, writeRaw, deletePublished, readDraftRaw, writeDraftRaw, deleteDraft, hasDraft) must now be async and return a Promise; parse/serialize stay sync."
  - pattern: "\\badapter\\.root\\b|config\\.adapter\\.root\\b"
    glob: "**/*.{ts,tsx}"
    hint: "ContentAdapter.root was removed from the interface. createMarkdownAdapter still returns it (now typed as MarkdownAdapter = ContentAdapter & { readonly root: string }); a GitHub or Notion adapter has no root at all."
  - pattern: "notionRequestSync\\(|from\\s+[\"']node:child_process[\"']"
    glob: "**/*.{ts,tsx}"
    hint: "The Notion adapter's spawnSync bridge is gone; createFetchNotionClient now does a plain await fetch and takes an injectable fetchImpl, the same convention as createGithubAdapter."
  - pattern: "createGithubAdapter\\("
    glob: "**/*.{ts,tsx}"
    hint: "draftBranch now defaults to \"typren-drafts\" instead of the same branch as published content. Pass draftBranch: null to keep the previous single-branch layout, or make sure your host's build config ignores the new branch."
---
## What changed

`ContentAdapter` (and so `ContentStore`) is now fully async: `listSlugs`,
`listLocales`, `exists`, `readRaw`, `writeRaw`, `deletePublished`,
`readDraftRaw`, `writeDraftRaw`, `deleteDraft` and `hasDraft` all return a
`Promise` now. `parse`/`serialize` are unchanged (pure, sync). This closes
issue #29: a network-backed adapter (GitHub, Notion) can now implement
`ContentAdapter` natively instead of needing a sync-bridging workaround.

Three smaller breaking changes ride along with it:

- **`ContentAdapter.root` was removed from the interface.** It was only ever
  meaningful for a filesystem-backed adapter. `createMarkdownAdapter` still
  returns it, now via the exported `MarkdownAdapter = ContentAdapter & {
  readonly root: string }` type. A caller that needs it (the Pages/collection
  dir-overlap guard, `createSettingsStore`'s `.typren/` location) narrows with
  `"root" in adapter` first.
- **`CmsConfig.settingsAdapter` is unchanged**; it was already the bootstrap
  (`typren.config.json`) adapter and still is. A NEW optional
  `CmsConfig.settingsContentAdapter?: ContentAdapter` was added for where the
  SiteSettings *content* doc itself lives. A markdown Pages adapter needs no
  change (the location is derived from `root` exactly as before). A GitHub or
  Notion Pages adapter (no `root`) must now set `settingsContentAdapter`
  explicitly; `createSettingsStore` throws a clear `typren:` error at
  construction if it's missing.
- **The Notion adapter's `spawnSync`-based bridge is gone.** `NotionClient`'s
  methods are now all async, and `createFetchNotionClient` does a plain
  `await fetch` with an injectable `fetchImpl` (same convention as
  `createGithubAdapter`), no child-process spawn per call.
- **`createGithubAdapter` now defaults `draftBranch` to `"typren-drafts"`,
  a behavior change, not just an added option.** Drafts used to live under
  `draftSubdir` on the same branch as published content (`branch`); they now
  live on a separate branch by default, created lazily from `branch`'s HEAD
  on the first draft save. A host whose platform builds every branch
  (Vercel previews, CF Pages branch deploys) needs that branch ignored (see
  the package README's "Drafts live on their own branch"). Pass
  `draftBranch: null` to keep the previous single-branch layout unchanged.

## Fix

1. Add `await` at every `ContentStore`/`ContentAdapter` read or write call
   this note's detectors (or `tsc`) flag. TypeScript errors are authoritative
   here: run `npx tsc --noEmit` and fix every resulting error, the regex
   detectors above are a heuristic head start, not the full list.
2. If you wrote a custom `ContentAdapter` (a type annotation or `satisfies
   ContentAdapter`), make every I/O method `async` (or return a `Promise`
   directly). `parse`/`serialize` stay sync.
3. If your code reads `adapter.root` (or `config.adapter.root`) off a
   markdown-backed Pages adapter, import and use the `MarkdownAdapter` type
   from `@typren/core` so TypeScript knows `root` is there; drop the usage
   entirely if the adapter might not be filesystem-backed.
4. If `config.adapter` is a GitHub or Notion adapter (anything with no
   `root`), add `settingsContentAdapter` to your `CmsConfig` (typically
   another `createMarkdownAdapter` pointed at a private settings dir, or a
   second instance of whatever backend you're already using).
5. If you called Notion's internal `notionRequestSync` directly, or
   constructed your own `NotionClient` with synchronous methods, update it to
   return promises; `createFetchNotionClient(token, fetchImpl?)` now takes an
   optional injectable `fetchImpl` for tests, the same shape
   `createGithubAdapter`'s `fetchImpl` option already has.
6. If you use `createGithubAdapter` and want to keep drafts on `branch`
   (the pre-0.5 layout), pass `draftBranch: null` explicitly. Otherwise, make
   sure your host's build config ignores the new `typren-drafts` branch so a
   draft save doesn't trigger an unwanted deploy.

## Verify

`npx tsc --noEmit` and the site build pass.
