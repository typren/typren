---
title: "@typren/core reference"
description: Every export, option and subpath of @typren/core, the framework-agnostic engine behind Typren.
category: Reference
order: 50
---

This page documents every public export of `@typren/core`, grouped by the subpath you import it from. See [architecture](./architecture.md) for how these pieces fit together, and [quickstart](./quickstart.md) for a walkthrough.

## "."

The package root: everything a site needs to wire up the CMS engine itself (adapters, the store, auth-gated actions, i18n, media, sections, settings, redirects, static-host routing). Re-exports from `types.js`, `i18n.js`, `localize.js`, `markdown-adapter.js`, `notion-adapter.js`, `notion-blocks.js`, `fs-media-adapter.js`, `github-adapter.js`, `media.js`, `store.js`, `actions.js`, `auth-adapter.js`, `file-policy.js`, `version.js`, `field-schema.js`, `sections.js`, `settings.js`, `collection.js`, `redirects.js`, `redirect-sources.js`, and `static-host.js`.

### types.js

Core type definitions shared across the package. No runtime exports; this is where `Slice`, `PageContent`, `LocalizedPage`, `PageInfo`, `CollectionRecordInfo`, `ContentAdapter`, `MediaAdapter`, `CmsConfig`, `FieldDef`, `SliceSchema`, `MediaAsset`, and `PreparedFile` live.

| Export | Signature | Notes |
|---|---|---|
| `Slice` | `{ slice: string } & Record<string, unknown>` | One content block; `slice` is the registry key, the rest are its props. |
| `PageContent` | `{ meta: Record<string, unknown>; slices: Slice[]; body: string }` | A page's editable content. |
| `LocalizedPage` | `PageContent & { locale: string; isFallback: boolean }` | A page read for a specific locale. `isFallback` is true when the requested locale had no file and the default locale's content was served instead. |
| `PageInfo` | `{ slug: string; title: string; hasDraft: boolean; locales: string[] }` | Summary row for the page picker. |
| `CollectionRecordInfo` | `{ slug: string; meta: Record<string, unknown>; body: string; hasDraft: boolean; locale?: string }` | One row of a collection's list view. `body` is required (not optional), so a host can't accidentally round-trip a save that blanks it. |
| `FieldDef` | `{ type?: "text" \| "textarea" \| "number" \| "boolean" \| "select" \| "yaml" \| "image" \| "media" \| "richtext" \| "icon" \| "color" \| "link" \| "slot"; options?: string[]; label?: string; of?: SliceSchema; itemLabel?: string }` | Editor hint for a single prop. Without one, the control is auto-detected from the value's JS type. |
| `SliceSchema` | `Record<string, FieldDef>` | Field hints for one slice, keyed by prop name. |
| `MediaAsset` | `{ id: string; url: string; name: string; size: number; width?: number; height?: number; mime: string; createdAt: string }` | Metadata for one stored media asset. |
| `PreparedFile` | `{ name: string; mime: string; buffer: Buffer; width?: number; height?: number }` | An upload that already passed validation + web-optimization. Adapters never see raw client uploads, only this. |
| `MediaAdapter` | `interface { list(): Promise<MediaAsset[]>; upload(file: PreparedFile): Promise<MediaAsset>; delete(id: string): Promise<void> }` | The only thing that knows where/how media files are stored. |
| `ContentAdapter` | see below | The only thing that knows where/how content is stored and serialized. |
| `CmsConfig` | see below | The one object that wires the CMS into a project. |

**`ContentAdapter` interface** (async throughout, except `parse`/`serialize`):

| Member | Signature | Notes |
|---|---|---|
| `locales` | `readonly string[]` | Locale allowlist; the adapter is the storage authority for it. |
| `defaultLocale` | `readonly string` | |
| `listSlugs(locale?)` | `Promise<string[]>` | Slugs of every editable (sliced) page in a locale. |
| `listLocales(slug)` | `Promise<string[]>` | Locales in which `slug` has a published file. |
| `exists(slug, locale?)` | `Promise<boolean>` | |
| `readRaw(slug, locale?)` | `Promise<string>` | Rejects if the slug is absent; callers gate with `exists`. |
| `writeRaw(slug, raw, locale?, opts?)` | `Promise<void>` | `opts.expectedVersion` asks the adapter to compare-and-swap: the write only lands if the path's current version still matches, else it rejects with `ConflictError`. An adapter with no atomic primitive (markdown, Notion) may ignore `opts` and keep unconditional overwrite. |
| `deletePublished(slug, locale?)` | `Promise<void>` | |
| `readDraftRaw(slug, locale?)` | `Promise<string \| null>` | `null` when no draft is checked out. |
| `writeDraftRaw(slug, raw, locale?, opts?)` | `Promise<void>` | Same `expectedVersion` CAS option as `writeRaw`. |
| `deleteDraft(slug, locale?)` | `Promise<void>` | |
| `hasDraft(slug, locale?)` | `Promise<boolean>` | |
| `parse(raw)` | `PageContent` | Sync, pure, no I/O. |
| `serialize(page)` | `string` | Sync, pure, no I/O. |

> Every method except `parse`/`serialize` is fully async (returns a `Promise`): `listSlugs`, `listLocales`, `exists`, `readRaw`, `writeRaw`, `deletePublished`, `readDraftRaw`, `writeDraftRaw`, `deleteDraft`, and `hasDraft` all return a `Promise`. This lets a non-filesystem adapter (GitHub, Notion) implement the interface natively instead of faking sync I/O.

**`CmsConfig` fields:**

| Option | Type | Default | Notes |
|---|---|---|---|
| `registry` | `Record<string, ComponentType<unknown>>` | required | Slice name to component. |
| `defaults` | `Record<string, Record<string, unknown>>` | required | Starter props inserted when a slice is added. |
| `fieldSchema` | `Record<string, SliceSchema>` | none | Per-slice field hints. |
| `adapter` | `ContentAdapter` | required | |
| `previewPath` | `string` | required | Route the editor iframes for live preview. |
| `auth` | `AuthAdapter` | none | Preferred over `authorize`. |
| `authorize` | `() => boolean \| Promise<boolean>` | none | Deprecated; legacy zero-arg gate. A config must set `auth` or this. |
| `i18n` | `I18nConfig` | single implicit locale | |
| `onPublish` | `(slug, locale) => void \| Promise<void>` | none | Publish side-effect (e.g. `revalidatePath`). |
| `onSaveDraft` | `(slug, locale, version) => void` | none | Fired synchronously right after the draft write; not awaited by `store.saveDraft`. |
| `mediaAdapter` | `MediaAdapter` | none | Omit to disable media management. |
| `sections` | `Section[]` | the default trio (pages, media, settings) | |
| `settingsAdapter` | `SettingsAdapter` | derived from `adapter`'s root | |
| `settingsContentAdapter` | `ContentAdapter` | none | Required when `adapter` has no filesystem root (GitHub, Notion). |
| `onboarding` | `false` | auto-detect | `false` disables first-run onboarding. |
| `siteId` / `accountId` | `string` | none | Hosted-platform tenant scope, threaded into every `AuthContext`. |

#### Errors

`CmsConfig` itself throws nothing directly; validation happens in the functions that consume it (`resolveAuth`, `createSettingsStore`, `resolveSections`, `resolveI18n`), covered under their own sections below.

### i18n.js

See the dedicated [`./i18n`](#i18n) subpath below; the same exports (`resolveI18n`, `localizedPath`, `localizedHref`, `routeLocale`, `defaultIsUnprefixed`, `I18nConfig`, `Messages`, `RoutingMode`, `LocaleRoute`) are re-exported from the package root.

### localize.js

| Export | Signature | Notes |
|---|---|---|
| `mergeLocalized(base, loc)` | `(base: PageContent, loc: PageContent \| null) => PageContent` | Merges a locale-specific page over the default-locale base. `meta` merges field-by-field; `slices` replaces whole-array (no per-slice merge); `body` falls back to the base when the locale file omits it. `loc: null` means page-level fallback (serve base as-is). |
| `localeSubdir(locale, defaultLocale)` | `(locale: string, defaultLocale: string) => string` | Path segment for a locale's content: `""` for the default locale (flat at the content root), `"<locale>/"` otherwise. |

#### Errors

Neither function throws; they are pure transforms.

### markdown-adapter.js

| Export | Signature | Notes |
|---|---|---|
| `createMarkdownAdapter(opts)` | `(opts: MarkdownAdapterOptions) => MarkdownAdapter` | Filesystem + gray-matter `ContentAdapter`. `MarkdownAdapter` extends `ContentAdapter` with a `readonly root: string` (the absolute on-disk root), used by `createSettingsStore` to site a sibling `.typren/` dir. |

| Option | Type | Default | Notes |
|---|---|---|---|
| `contentDir` | `string` | required | Absolute path to the directory of `<slug>.md` files. The default locale lives flat here; other locales live under `<locale>/`. |
| `draftDir` | `string` | `<contentDir>/<draftSubdir>` | Non-default locales always draft under `<contentDir>/<locale>/<draftSubdir>`. |
| `frontmatterKey` | `string` | `"slices"` | Frontmatter key holding the slice array. |
| `locales` | `string[]` | `[defaultLocale]` | Locale allowlist. |
| `defaultLocale` | `string` | `"en"` | |
| `draftSubdir` | `string` | `".drafts"` | |
| `requireSliceArray` | `boolean` | `true` | Whether `listSlugs` only counts files carrying a slice array under `frontmatterKey`. Collections set this to `false` (see `makeCollectionAdapter`), since every file in a collection dir is a record, slices or not. |

#### Errors

- Throws `typren: unsafe slug "<slug>"` when `slug` fails the safe-slug allowlist check.
- Throws `typren: unknown locale "<locale>"` when `locale` isn't in the configured `locales`.

### notion-adapter.js

| Export | Signature | Notes |
|---|---|---|
| `createNotionAdapter(opts)` | `(opts: NotionAdapterOptions) => ContentAdapter` | Notion-backed `ContentAdapter`. One database row = one record. |
| `createFetchNotionClient(token, fetchImpl?)` | `(token: string, fetchImpl?: typeof fetch) => NotionClient` | Real `NotionClient` against `https://api.notion.com`. Pass `token` from `process.env` only. |

| Option | Type | Default | Notes |
|---|---|---|---|
| `client` | `NotionClient` | required | |
| `databaseId` | `string` | required | |
| `properties` | `NotionPropertyMap` | required | metaKey to Notion property name + type. |
| `slugProperty` | `string` | none | metaKey of a plain-text property used as the record slug instead of the Notion page id. **Required to create new records**: a page id doesn't exist until Notion assigns one. Without it, slugs must be the Notion page's own UUID, and rows belonging to another database are not found or resolved (the adapter checks the row's `parent.database_id` against the configured `databaseId`). |
| `bodyProperty` | `string` | none | metaKey of a rich_text property round-tripped as `PageContent.body`. Ignored when `content` is `"blocks"` or `"slices"`. |
| `content` | `"blocks" \| "slices" \| "none"` | `"none"` | `"blocks"`: body is the page's own block content converted to markdown. `"slices"`: the page reads as a full typren page record via `blocksToSegments` + `pageRecordFrom`. Both require a `client.listBlockChildren` implementation (throws otherwise) and are **read-only**: `writeRaw`/`writeDraftRaw` only ever push `properties`, never block content. |
| `locales` | `string[]` | none | |
| `defaultLocale` | `string` | none | |

#### Errors

- `writeRaw` on an unknown slug throws `typren: cannot create notion record "<slug>" without a slugProperty configured` when no `slugProperty` is set.
- `readRaw` throws `typren: notion record "<slug>" not found` when the slug doesn't resolve.
- Throws `typren: content: "<content>" needs a NotionClient with listBlockChildren implemented` when `content` is `"blocks"`/`"slices"` but the client omits it.
- Throws `typren: unknown locale "<locale>"` for an unconfigured locale.
- Throws `typren: slugProperty "<slugProperty>" is not in properties` at construction if `slugProperty` doesn't name a configured property.
- Throws `typren: notion property "<name>" expected type "<type>" but got "<actual>"` on a property type mismatch.
- Throws on any non-ok Notion API response, with the method, path, status and response body in the message.

> Notion has no draft/publish distinction: every draft write goes straight through to the published row (`writeDraftRaw` calls the same path as `writeRaw`; `readDraftRaw`/`hasDraft` always report no draft). This drops optimistic-locking and "unpublished changes" UX for Notion-backed collections.

### notion-blocks.js

Generic Notion block tree to typren content conversion, no entity- or component-specific knowledge.

| Export | Signature | Notes |
|---|---|---|
| `richTextToMarkdown(runs)` | `(runs: unknown) => string` | A Notion rich_text array to one inline markdown string. |
| `blocksToSegments(blocks)` | `(blocks: NotionBlock[]) => NotionSegment[]` | Groups top-level blocks into an ordered list of prose runs and component calls. A block whose first line is `::componentName` (in a `callout` or `code` block) is a component call; the rest of the block is parsed as JSON props. Malformed JSON, a missing name, or an empty prop body all degrade to ordinary prose rather than throwing. |
| `blocksToMarkdown(blocks)` | `(blocks: NotionBlock[]) => string` | Renders every prose segment as one markdown string; a component segment becomes a visible HTML comment marker, never silently dropped. |
| `pageRecordFrom(segments, opts?)` | `(segments: NotionSegment[], opts?: { proseSlice?: string; meta?: Record<string, unknown> }) => PageContent` | Maps every segment into one ordered typren `slices` array (no `body`). A host must register a `proseSlice`-named component (default `"prose"`) that renders `markdown`. |

#### Errors

None of these functions throw; malformed input degrades gracefully (treated as prose) rather than failing.

### fs-media-adapter.js

| Export | Signature | Notes |
|---|---|---|
| `createFsMediaAdapter(opts)` | `(opts: FsMediaAdapterOptions) => MediaAdapter` | Filesystem media adapter over a flat directory. `list()` probes image dimensions via sharp. |

| Option | Type | Default | Notes |
|---|---|---|---|
| `dir` | `string` | required | Absolute path assets are read from/written to. |
| `publicPath` | `string` | required | Public URL prefix the dir is served under, e.g. `"/img"`. |

#### Errors

- Throws `typren: unsafe media id "<id>"` when `id` fails the safe-name allowlist or contains `..`.

### github-adapter.js

| Export | Signature | Notes |
|---|---|---|
| `isAllowedRepoPath(relPath, allowedRoots)` | `(relPath: string, allowedRoots: string[]) => boolean` | True when `relPath` safely resolves inside one of `allowedRoots`. Rejects `..`, absolute paths, any dotfile/dot-dir path segment, and well-known manifest filenames (`package-lock.json`, `bun.lock`, `bun.lockb`, `pnpm-lock.yaml`, `yarn.lock`). |
| `createGithubAdapter(opts)` | `(opts: GithubAdapterOptions) => ContentAdapter` | GitHub Contents API adapter. Every write does a read-sha-then-write, CAS'd server-side by GitHub against that sha. |

| Option | Type | Default | Notes |
|---|---|---|---|
| `owner` / `repo` | `string` | required | |
| `token` | `string` | required | Installation access token; minting/refreshing it is the caller's job. |
| `branch` | `string` | `"main"` | Every read/write targets this branch directly; PR-based writes are a caller-level policy this adapter doesn't implement. |
| `draftBranch` | `string \| null` | `"typren-drafts"` | Every draft read/write/delete/`hasDraft` call targets this branch instead of `branch`, so saving a draft never lands a commit on the branch a host builds from. The branch is auto-created from `branch`'s current HEAD the first time a draft is ever saved (a site that never saves a draft never gets one). Pass `null` (or the same value as `branch`) to keep drafts living under `draftSubdir` on `branch` itself (no second branch). |
| `contentDir` | `string` | `"content"` | |
| `mediaDir` | `string` | `"public/img"` | Accepted for allowlist validation; no method here writes to it yet. |
| `frontmatterKey` | `string` | `"slices"` | |
| `locales` | `string[]` | `[defaultLocale]` | |
| `defaultLocale` | `string` | `"en"` | |
| `draftSubdir` | `string` | `"_drafts"` | Deliberately distinct from `markdown-adapter`'s `.drafts`: this adapter's write-path allowlist rejects dotfile/dot-dir path segments, so a dot-prefixed default would make every draft write reject itself. |
| `fetchImpl` | `typeof fetch` | global `fetch` | Injectable for tests. |
| `readInit` | `(relPath: string) => RequestInit \| undefined` | none | Merged into every GET's `RequestInit` (reads only, never writes), e.g. Next's `{ next: { tags: [...] } }`. Never set this on the editor's own adapter instance: draft reads must always be fresh. |

Writes (`writeRaw`, `writeDraftRaw`, `deletePublished`, `deleteDraft`) are serialized per adapter instance: every write runs through one chain, one at a time, so two concurrent writes (e.g. `deletePage`'s per-locale deletes) can't race against the same cached sha. Reads stay parallel.

#### Errors

- Throws `typren: unsafe slug "<slug>"` / `typren: unknown locale "<locale>"` (same shape as markdown-adapter).
- Throws `typren: path "<relPath>" is outside the allowed write roots` when a write path fails `isAllowedRepoPath`.
- Throws `ConflictError` when `writeRaw`/`writeDraftRaw`'s `expectedVersion` no longer matches, or a delete gets a 409/422 from GitHub.
- Throws `typren: GitHub read/write/delete/list of "<relPath>" failed (<status>): <body>` on any other non-ok GitHub response.
- Throws `typren: could not resolve HEAD of "<branch>" to create draft branch "<ref>" (<status>)` / `typren: could not create draft branch "<ref>" (<status>): <body>` if lazy draft-branch creation fails (a 422, meaning the ref already exists, is swallowed as a race with another request).
- Throws `typren: "<slug>" does not exist` when a read resolves to no file.

### media.js

| Export | Signature | Notes |
|---|---|---|
| `MAX_UPLOAD_BYTES` | `number` | Pre-conversion upload cap. Sharp's own `limitInputPixels` default (~268 megapixels) is relied on for decompression-bomb protection. |
| `processUpload(input)` | `(input: { name: string; buffer: Buffer }) => Promise<PreparedFile>` | Validates + web-optimizes a raw upload; sniffs actual bytes via `sharp.metadata()`, never trusts the client-supplied mime/extension. |
| `handleMediaUpload(config, request)` | `(config: CmsConfig, request: Request) => Promise<Response>` | Route Handler body; re-checks auth itself via `resolveAuth` since a Route Handler never runs through a parent layout's auth gate. |

#### Errors

- `processUpload` throws `typren: upload exceeds <N>MB limit` when the input exceeds `MAX_UPLOAD_BYTES`.
- `processUpload` throws `Unsupported image format: <format>. Upload PNG, JPEG, GIF, WebP, AVIF, or SVG.` for any other sniffed format.

### store.js

| Export | Signature | Notes |
|---|---|---|
| `slugify(text)` | `(text: string) => string` | Lowercase, alnum-and-dash only, no leading/trailing dashes. Shared by `createPage` and `duplicatePage`. |
| `createStore(adapter, opts?)` | `(adapter: ContentAdapter, opts?: { onPublish?; onSaveDraft?; defaultLocale?: string }) => ContentStore` | |

`ContentStore` interface:

| Member | Signature | Notes |
|---|---|---|
| `listPages(locale?)` | `Promise<PageInfo[]>` | |
| `listSlugs(locale?)` | `Promise<string[]>` | Cheap: just `adapter.listSlugs`, no per-page read. Prefer this over `listPages` for sitemap/llms.txt/redirects builders. |
| `exists(slug, locale?)` | `Promise<boolean>` | Cheap existence check, unlike `listPages`'s full fan-out. |
| `getPublished(slug, locale?)` | `Promise<LocalizedPage>` | Default-locale fallback applied. |
| `getDraft(slug, locale?)` | `Promise<PageContent \| null>` | |
| `currentVersion(slug, locale?)` | `Promise<string \| null>` | Version of what the editor would load: draft if present, else published, else `null`. |
| `saveDraft(slug, page, baseVersion?, locale?)` | `Promise<string>` | Throws `ConflictError` if `baseVersion` is given and the current version has moved. Returns the new version. |
| `discardDraft(slug, locale?)` | `Promise<void>` | |
| `publish(slug, baseVersion?, locale?)` | `Promise<void>` | Throws `ConflictError` if `baseVersion` is given and the draft moved since. |
| `createPage(slug, page, locale?)` | `Promise<void>` | Throws if the page already exists. |
| `createTranslation(slug, fromLocale, toLocale)` | `Promise<void>` | No-op if `toLocale` already has content or a draft. |
| `deletePage(slug)` | `Promise<void>` | Deletes in ALL locales plus their drafts. |
| `deleteTranslation(slug, locale)` | `Promise<void>` | |
| `renamePage(slug, newSlug)` | `Promise<void>` | Moves published AND draft content, in every locale the source occupies. Throws `SlugExistsError` (not `ConflictError`) if `newSlug` already has content anywhere the move would touch. No-op if `newSlug === slug`. |
| `duplicatePage(slug, locale?)` | `Promise<string>` | Copies published AND draft content (whichever exist) to a new, auto-derived slug. Single-locale only. Throws if `slug` has neither published nor draft content. |

Operations that fan out over every slug in the store (`listPages`, and anything built on it) cap concurrent adapter calls at 8 (`mapLimit`), to bound load against GitHub/Notion rate limits and fs file-descriptor limits.

#### Errors

- `saveDraft`/`publish` throw `ConflictError` on a stale `baseVersion`.
- `createPage` throws `typren: page "<slug>" already exists` when the slug already has content.
- `renamePage`/`duplicatePage` throw `SlugExistsError` on a destination-slug collision.
- `duplicatePage` throws `typren: page "<slug>" does not exist` when there's nothing to copy.

### actions.js

| Export | Signature | Notes |
|---|---|---|
| `makeActions(config)` | `(config: CmsConfig) => CmsActions` | Builds the mutation handlers for a config. Every handler calls `auth.authorize()` before touching the store, since a Server Action is a public POST endpoint. Every handler takes an optional `locale` (defaults to the default locale). |

`CmsActions` (the object `makeActions` returns):

| Member | Signature | Notes |
|---|---|---|
| `saveDraft(slug, page, baseVersion?, locale?)` | `Promise<SaveResult>` | `SaveResult` is `{ ok: true; version: string } \| { ok: false; code: "conflict"; currentVersion: string \| null }`, a **returned** union, not a thrown error: Next redacts thrown messages in production. |
| `discardDraft(slug, locale?)` | `Promise<void>` | |
| `publish(slug, baseVersion?, locale?)` | `Promise<SaveResult>` | |
| `createPage(title, locale?)` | `Promise<string>` | Returns the normalized slug. |
| `renamePage(slug, newSlug)` | `Promise<RenameResult>` | `RenameResult` is `{ ok: true; slug: string } \| { ok: false; code: "conflict" }` (no `currentVersion`: a rename conflict is a destination-slug collision, not a version race). |
| `duplicatePage(slug, locale?)` | `Promise<string>` | Gated as a `"createPage"` action. |
| `createTranslation(slug, toLocale)` | `Promise<void>` | Gated as a draft write. |
| `deletePage(slug)` | `Promise<void>` | |
| `deleteTranslation(slug, locale)` | `Promise<void>` | |
| `listMedia()` | `Promise<MediaAsset[]>` | |
| `deleteMedia(id)` | `Promise<void>` | |

`PageActions` is `Omit<CmsActions, "listMedia" | "deleteMedia" | "renamePage" | "duplicatePage">`: the subset the editor UI shells actually call.

#### Errors

- Every handler throws `typren: unauthorized` when `auth.authorize()` denies the action (auth denial fails loud, unlike a version conflict which is returned as data).
- `createPage` throws `typren: page name is required` for an empty title.
- `renamePage` throws `typren: new slug is required` for an empty target.
- `listMedia`/`deleteMedia` throw `typren: no mediaAdapter configured` when `config.mediaAdapter` is unset.

### auth-adapter.js

See the auth model covered under each `./auth/*` subpath below for the adapter implementations; this module defines the shared interface.

| Export | Signature | Notes |
|---|---|---|
| `legacyAuthAdapter(fn)` | `(fn: () => boolean \| Promise<boolean>) => AuthAdapter` | Back-compat shim wrapping the legacy zero-arg `CmsConfig.authorize()` closure. |
| `withPolicy(identity, policy)` | `(identity: AuthAdapter, policy: Policy) => AuthAdapter` | Composes an identity adapter ("who is this?") with a `Policy` ("what may they do?"). `identity`'s own `authorize()` is never called; the policy is authoritative. Fails closed: no `getUser`, no user, or any resolution error denies. |
| `resolveAuth(config)` | `(config: { auth?: AuthAdapter; authorize?: () => boolean \| Promise<boolean> }) => AuthAdapter` | Single resolution point used by both the action guard and the layout gate. |

`AuthAdapter` interface: `getUser?(ctx): Promise<AuthUser | null>` (optional), `authorize(ctx): Promise<boolean>` (**must fail closed on any error**).

`AuthAction` is `"read" | "saveDraft" | "discardDraft" | "publish" | "createPage" | "renamePage" | "deletePage" | "uploadMedia" | "deleteMedia" | "admin"`. `"admin"` covers bootstrap/settings/onboarding writes, gated separately from ordinary content writes.

> **Security:** `authorize()` must fail closed on any error. Every shipped adapter wraps identity resolution in try/catch and returns `false` on failure; a thrown error must never default to allowed.

#### Errors

- `resolveAuth` throws `typren: CmsConfig needs either auth (AuthAdapter) or authorize` when a config sets neither.

### file-policy.js

| Export | Signature | Notes |
|---|---|---|
| `filePolicy(opts)` | `(opts: { file: string }) => Policy` | File-backed `Policy` reading YAML at `opts.file`. Default closed: no member entry or no action listed for the matched group denies, full stop. Read fresh on every call (no cache-invalidation logic needed for a small, git-committed file). |

`AccessPolicyFile` shape: `{ groups: Record<string, AuthAction[]>; members: Record<string, string> }` — `members` maps an exact email (case-insensitive) or a `"*@domain"` wildcard default to a group name.

> **Security:** keep `file`'s location OUTSIDE whatever the dashboard's `ContentAdapter` can write (`content/**`, the media dir). That's what closes the escalation trap of an editor promoting themselves to admin by editing the policy file through the CMS itself; nothing in `filePolicy` enforces that placement for you.

#### Errors

`filePolicy` itself never throws to its caller: `withPolicy` already wraps it in the fail-closed try/catch, so a missing file or malformed YAML denies rather than propagating.

### version.js

| Export | Signature | Notes |
|---|---|---|
| `versionOf(raw)` | `(raw: string) => string` | Content version = SHA-256 of the raw file text, truncated. Deterministic and adapter-agnostic (survives fs to KV to git), no mtime flakiness. |
| `ConflictError` | `class extends Error { slug; currentVersion: string \| null; baseVersion: string; code: "conflict" }` | Thrown by the store when a version-checked write loses a race. |
| `SlugExistsError` | `class extends Error { slug; code: "conflict" }` | Thrown by the store when a rename/duplicate would land on a slug that already has content. Distinct from `ConflictError`: this is two resources colliding, not an optimistic-lock race on one, so there is no `currentVersion`/`baseVersion`. Carries the same `code: "conflict"` discriminant so the action layer's result union and the 409 mapping in `api/routes.ts` don't need a second code path. |

#### Errors

These two classes ARE the errors other modules throw; `version.js` itself throws nothing on its own.

### field-schema.js

| Export | Signature | Notes |
|---|---|---|
| `isFieldSchema(value)` | `(value: unknown) => value is SerializedFieldSchema` | Runtime type guard; never throws. |
| `serializeFieldSchema(schema)` | `(schema: SerializedFieldSchema) => string` | `JSON.stringify` with stable formatting. |
| `parseFieldSchema(json)` | `(json: string) => SerializedFieldSchema` | Parses + validates a fieldSchema JSON document. |

`SerializedFieldSchema` is `Record<string, SliceSchema>`, `CmsConfig["fieldSchema"]`'s own shape named for a hosted dashboard reading it from a repo-committed JSON file.

#### Errors

- `parseFieldSchema` throws `typren: invalid fieldSchema JSON: <message>` on malformed JSON.
- `parseFieldSchema` throws on anything not shaped like `Record<sliceName, Record<fieldName, FieldDef>>`.

### sections.js

| Export | Signature | Notes |
|---|---|---|
| `SECTION_API_VERSION` | `1` | Bump only on a breaking change to `SectionCtx` or the custom mount/element calling convention. |
| `DEFAULT_SECTIONS` | `Section[]` | The default trio: pages, media, settings. |
| `resolveSections(config)` | `(config: { sections?: Section[] }) => ResolvedSection[]` | Back-compat resolver (same spirit as `resolveI18n`); omitted/empty `sections` collapses to `DEFAULT_SECTIONS`. Fills ids/defaults and validates loud. |

`Section` is a union: `PagesSection | MediaSection | SettingsSection | CollectionSection | CustomSection`.

| CollectionSection field | Type | Notes |
|---|---|---|
| `dir` | `string` | Repo-relative dir, e.g. `"content/authors"`. Gets its own markdown-backed `ContentAdapter`. Must not resolve inside the Pages `contentDir`. Provide exactly one of `dir`/`adapter`. |
| `adapter` | `ContentAdapter` | Pre-built adapter for a non-filesystem backend. Bypasses the Pages dir-overlap guard entirely. |
| `schema` | `SliceSchema` | A record IS a slice-shaped prop bag. |
| `titleField` | `string` | Default: `"title"`, then the first schema key, then the slug. |
| `columns` | `string[]` | Default: first 4 schema keys, title-cased. |

| CustomSection field | Type | Notes |
|---|---|---|
| `element` | `string` | A registered custom element tag; config-serializable, AI-authorable as a string. |
| `mount` | `(host: HTMLElement, ctx: SectionCtx) => void \| (() => void)` | Imperative fallback; returns an optional cleanup fn. |
| `host` | `true` | The embedding shell renders this section itself, keyed by `id`. Provide exactly one of `element`/`mount`/`host`. |

`SectionCtx` is the one context object every section renderer reads: `apiVersion`, `config.{registry, adapter, mediaAdapter}`, `actions` (`PageActions`), `collections` (`Record<string, PageActions>`), `settings` (`SettingsStore`), `settingsSnapshot`, `media`, `messages`, `locale`, `locales`, `defaultLocale`, `navigate(sectionId)`, `setTopBarAction(action | null)`, `capabilities` (`ReadonlySet<string>`, feature-detected rather than version-sniffed). Fields are additive-only: a field is never renamed or removed, only widened.

#### Errors

- `resolveSections` throws on a `CustomSection` declaring anything other than exactly one of `element`/`mount`/`host`.
- `resolveSections` throws `typren: duplicate section id "<id>"` on a collision.

### settings.js

| Export | Signature | Notes |
|---|---|---|
| `createFsSettingsAdapter(opts)` | `(opts: { file: string }) => SettingsAdapter` | Default bootstrap adapter: one root JSON, atomic tmp+rename write. |
| `createSettingsStore(config)` | `(config: CmsConfig) => SettingsStore` | Reuses `createStore`/`makeActions` on a private-dir adapter for the runtime half. |

`SiteSettingsRuntime`: `{ brand: { name: string; logo?: MediaAsset; logoDark?: MediaAsset }; seo: { titleTemplate?: string; description?: string; ogImage?: MediaAsset }; theme?: { preset?: "shadcn" | "neutral" } }`.

`SiteSettingsBootstrap`: `{ adminRoute: string; locales: string[]; defaultLocale: string; routing: RoutingMode; onboarded: boolean }` — not locale-scoped, not adapter-managed; a small root JSON read at server start.

`SettingsStore` interface: `get(locale?)`, `currentVersion(locale?)`, `saveDraft(next, baseVersion?, locale?)`, `publish(baseVersion?, locale?)`, `bootstrap: SettingsAdapter`.

When `config.adapter` carries a filesystem `root` (a markdown adapter), the settings content adapter is derived automatically as a sibling `.typren/` directory. A non-fs Pages adapter (GitHub, Notion) has no root to site a sibling dir next to, so it must set `config.settingsContentAdapter` explicitly.

#### Errors

- Throws if `config.settingsContentAdapter` is the same adapter instance as `config.adapter`: the `"settings"` slug would silently collide with a Pages slug of the same name.
- Throws if `config.settingsContentAdapter`'s root is the same as, or nested inside/around, `config.adapter`'s root, for the same collision reason.
- Throws `typren: config.adapter has no filesystem root (e.g. a GitHub or Notion adapter), so settings need an explicit config.settingsContentAdapter` when neither a filesystem root nor `settingsContentAdapter` is available.
- The settings write guard throws `typren: unauthorized` when the `"admin"` action is denied.

> **Security:** settings writes require the distinct `"admin"` `AuthAction`, checked in front of `makeActions`, since settings docs reparameterize what the next boot trusts (not just page content).

### collection.js

| Export | Signature | Notes |
|---|---|---|
| `makeCollectionAdapter(config, section)` | `(config: CmsConfig, section: CollectionSection) => ContentAdapter` | Resolves a collection section's own `ContentAdapter`, guarded against overlapping the Pages adapter's root. |
| `makeCollectionActions(config, section)` | `(config: CmsConfig, section: CollectionSection) => PageActions` | |
| `buildCollectionActions(config)` | `(config: CmsConfig) => Record<string, PageActions>` | |
| `listCollectionRecords(config, section, locale?)` | `(config: CmsConfig, section: CollectionSection, locale?: string) => Promise<CollectionRecordInfo[]>` | The list view's data source: collections have no client `"read"` action, so this is what a host's server-fetch calls into. |

#### Errors

- Throws `typren: collection section "<label>" must set exactly one of dir/adapter` when both or neither is set.
- Throws `typren: collection dir "<dir>" overlaps the Pages content dir` when a filesystem collection dir resolves inside the Pages `contentDir`.

### redirects.js

| Export | Signature | Notes |
|---|---|---|
| `buildRedirects(store, opts?)` | `(store: ContentStore, opts?: BuildRedirectsOptions) => Promise<RedirectEntry[]>` | One entry per page-declared alias (frontmatter `aliases: string[]`), validated and de-duplicated across the site. Single-locale only (reads the default-locale published page). |

| Option | Type | Default | Notes |
|---|---|---|---|
| `homeSlug` | `string` | none | Slug that maps to `"/"` instead of `"/<slug>"`. |
| `maxEntries` | `number` | `1000` | Hard ceiling on total alias entries; a safety valve, not a realistic target. |

`PageRedirectMeta`: `{ aliases?: string[] }`, lives inside a page's existing `meta`. `RedirectEntry`: `{ from: string; to: string; slug: string; status?: RedirectStatus }` (`status` undefined means 301; frontmatter aliases never set it, only a `--map` entry can, see redirect-sources.js below).

#### Errors (fail loud, never silently drops a bad entry)

- `typren: "<slug>" frontmatter "aliases" must be an array of paths` for a malformed `aliases` field.
- An alias that isn't an absolute on-site path.
- `typren: "<slug>" alias "<raw>" exceeds <N> characters` for an overlong alias.
- An alias that shadows a real page's own canonical path (including a page aliasing itself, a redirect loop).
- `typren: duplicate alias "<from>" claimed by both "<owner>" and "<slug>"` for a duplicate claimed by two pages.
- `typren: redirect count exceeds maxEntries (<N>)` when the total exceeds the cap.

### redirect-sources.js

| Export | Signature | Notes |
|---|---|---|
| `scanContentStore(contentDir)` | `(contentDir: string) => ContentStore` | Minimal read-only `ContentStore` built by scanning a content directory's flat `*.md` files directly, rather than importing a host's `cms.config.ts` (which would throw outside a React Server Component build). Only `listPages`/`getPublished` are real. |
| `loadRedirectMap(cwd, file)` | `(cwd: string, file: string) => Promise<RedirectEntry[]>` | Loads a host-supplied redirect map file (`.json`, or `.mjs`/`.js` exporting the array) into validated `RedirectEntry[]`. |
| `mergeRedirectEntries(content, map, pagePaths?)` | `(content: RedirectEntry[], map: RedirectEntry[], pagePaths?: string[]) => RedirectEntry[]` | Merges content-derived entries with map-file entries, refusing a `from` claimed by both sources or one that shadows a live page's canonical path. |
| `toRedirectPairs(entries, opts?)` | `(entries: RedirectEntry[], opts?: ToRedirectPairsOptions) => { key: string; value: string }[]` | Converts validated entries into key/value pairs: `from` percent-encoded, `to` canonicalized to the site's trailing-slash convention (`opts.appendSlash`, default `true`), with a non-301 `status` encoded as a `"<status> "` prefix on `value` (decoded back by `resolveStaticHostRequest`). |

`RedirectMapEntry`: `{ from: string; to: string; status?: 301 | 302 | 307 | 308 }` (`status` omitted means 301).

#### Errors

- `scanContentStore`'s returned store throws `typren: javascript front-matter is not supported` and `typren: scanContentStore is read-only, "<op>" is not supported` for any write attempt.
- `loadRedirectMap` throws `typren: map file not found: <path>` for a missing file, `typren: <file> must export an array of { from, to } entries` for a malformed export, `typren: <file> entry <i>: 'from' must be an absolute on-site path, got <value>` / the equivalent `'to'` message for invalid paths, `typren: <file> entry <i>: 'to' must not be protocol-relative` for a `//host` target, `typren: <file> entry <i>: 'status' must be one of 301, 302, 307, 308, got <value>` for an invalid status, `typren: <file> declares <key> twice` for a duplicate, `typren: <file> entry <i>: <key> redirects to itself` for a self-redirect, and `typren: unsupported map format "<ext>" (use .json, .mjs or .js)` for any other extension.
- `mergeRedirectEntries` throws `typren: <from> is declared by both "<owner>" (frontmatter) and "<slug>"` and `typren: <slug> redirects <from>, which is a live page's own path`.

### static-host.js

See the dedicated [`./static-host`](#static-host) subpath below; the same exports (`resolveStaticHostRequest`, `isUnsafeRedirectTarget`, `STATIC_HOST_PASSTHROUGH`, `StaticHostDecision`, `RedirectLookup`) are re-exported from the package root.

## "./i18n"

Pure locale/routing helpers, no `node:fs`, safe to import in middleware/edge runtimes.

| Export | Signature | Notes |
|---|---|---|
| `resolveI18n(i18n?)` | `(i18n?: Partial<I18nConfig>) => I18nConfig` | Validates + fills defaults. A missing/empty block collapses to a single implicit locale (byte-identical behavior for single-locale sites). |
| `defaultIsUnprefixed(i18n)` | `(i18n: I18nConfig) => boolean` | True when the default locale carries no URL prefix. |
| `localizedPath(i18n, path, locale)` | `(i18n: I18nConfig, path: string, locale: string) => string` | e.g. `/about` to `/es/about` (es) or `/about` (en, `prefix-except-default`). |
| `localizedHref(i18n, href, locale)` | `(i18n: I18nConfig, href: string, locale: string) => string` | Like `localizedPath` but leaves external/anchor/mailto hrefs untouched. |
| `routeLocale(i18n, pathname)` | `(i18n: I18nConfig, pathname: string) => LocaleRoute` | Pure routing decision for the edge proxy. Never rewrites to a route that can't exist for the preset. |

`I18nConfig`: `{ locales: string[]; defaultLocale: string; routing: RoutingMode; messages?: Record<string, Partial<Messages>> }`. `RoutingMode` is `"prefix-except-default" | "prefix-all"`. `LocaleRoute` is `{ type: "next" } | { type: "redirect"; pathname: string } | { type: "rewrite"; pathname: string }`.

### Errors

- `resolveI18n` throws `typren: defaultLocale "<locale>" not in locales [...]` when `defaultLocale` isn't in `locales`.

## "./proxy"

Edge-safe locale rewrite, same `node:fs`-free constraint as `./i18n`.

| Export | Signature | Notes |
|---|---|---|
| `currentAdminRoute(file?)` | `(file?: string) => string` | Current `adminRoute` from `typren.config.json`, mtime-cached so a steady file costs one `statSync` per request. Missing file or missing/invalid field falls back to `"editor"`. |
| `previewPathFor(adminRoute)` | `(adminRoute: string) => string` | Derived from the live admin route so it can never drift from `currentAdminRoute`. |
| `typrenProxyRewrite(url, opts?)` | `(url: URL \| string, opts?: { configFile?: string }) => string \| null` | Maps `/<adminRoute>/**` to `/editor/**`; returns `null` when no rewrite applies, so a host's proxy can fall through to its own logic. Accepts `URL \| string` so it works unchanged on both the Node.js and edge convention. |

### Errors

None of these throw; a missing or invalid config file degrades to defaults.

## "./static-host"

Request routing for a fully static export (no server at request time): redirect/rewrite lookups against a host-supplied store.

| Export | Signature | Notes |
|---|---|---|
| `STATIC_HOST_PASSTHROUGH` | `ReadonlySet<string>` | |
| `REDIRECT_STATUSES` | `readonly [301, 302, 307, 308]` | The allowlisted redirect statuses; `RedirectStatus` is the union of its members. |
| `isUnsafeRedirectTarget(target)` | `(target: string) => boolean` | True for a protocol-relative target (`"//host"`), one using a backslash (URL parsers read `\` as `/`), or one carrying control characters (header injection). A redirect target arrives from a store an operator with write access can edit directly, so this refusal is the trust boundary. Checked against the target AFTER any status prefix (below) is stripped. |
| `resolveStaticHostRequest(path, query, lookup, opts?)` | `(path: string, query: string, lookup: RedirectLookup, opts?: StaticHostOptions) => Promise<StaticHostDecision>` | `path` is the request path exactly as received (percent-encoded); `query` is the raw query string without a leading `?`. A lookup result may carry a status prefix (`"<301\|302\|307\|308> <target>"`); a bare value defaults to 301, and a recognized-shape prefix outside that allowlist (e.g. `"404 /x"`) is an invalid entry, treated as "no redirect" (fails open). |

| Option | Type | Default | Notes |
|---|---|---|---|
| `trailingSlash` | `boolean` | `true` | The export's URL shape (Next's `trailingSlash`). `true`: `/about/` serves `about/index.html`. `false`: `/about` serves `about.html`. |

`StaticHostDecision` is `{ kind: "redirect"; status: RedirectStatus; location: string } | { kind: "rewrite"; path: string } | { kind: "pass" }`. `RedirectLookup` is `(key: string) => Promise<string | null | undefined> | string | null | undefined`; a throw/rejection and a null/undefined/empty result both mean "no redirect here".

### Errors

`resolveStaticHostRequest` does not throw; a lookup failure is treated as "no redirect" and falls through to `{ kind: "pass" }`.

## "./api"

A WHATWG `Request` to `Response` handler for the editor's HTTP API, framework-agnostic (Next Route Handler, Hono, `Bun.serve`, Deno all work unchanged). Re-exports `createTyprenApi`, `TyprenApiOptions`, `CmsConfigFactory` from `routes.js`, and `createTyprenClient`, `TyprenApiError`, `TyprenClient`, `TyprenClientOptions` from `client.js`.

| Export | Signature | Notes |
|---|---|---|
| `createTyprenApi(config, options?)` | `(config: CmsConfig \| CmsConfigFactory, options?: TyprenApiOptions) => { handler; GET; POST; PUT; PATCH; DELETE }` | `config` may be a `CmsConfigFactory` (resolved fresh per request for a multi-tenant host); the result is never cached across requests. |

| Option | Type | Default | Notes |
|---|---|---|---|
| `basePath` | `string` | inferred from the request | Path prefix to strip before matching. |
| `allowedOrigins` | `string[]` | same-origin only | Extra origins allowed to send writes (CSRF protection). Requests with no `Origin` header (server-to-server, curl) are always allowed, since CSRF needs a browser to attach credentials. |

`CmsConfigFactory` is `(request: Request) => CmsConfig | Promise<CmsConfig>`.

Routes (see the module's own doc comment for the full table): `GET/POST /pages`, `GET/PUT/DELETE /pages/:slug[/draft]`, `POST /pages/:slug/publish`, `POST /pages/:slug/rename`, `POST /pages/:slug/duplicate`, `DELETE /pages/:slug`, `POST/DELETE /pages/:slug/translations[/:locale]`, the same shape under `/collections/:id`, `GET/POST/DELETE /media[/:id]`, and `GET/PUT/POST /settings[/draft|/publish|/bootstrap]`.

> **Security:** every write routes through `makeActions`/`createSettingsStore`, which call `authorize()` themselves; this layer never re-implements the gate. It does own origin checking on unsafe methods (CSRF) and read gating, since a bare GET never reaches an action guard.

### Errors

An unauthorized action is a thrown `Error` from the action guard, mapped to an HTTP status by this layer rather than re-thrown.

## "./api/client"

A browser-safe `fetch` client for the HTTP API above, no server imports.

| Export | Signature | Notes |
|---|---|---|
| `createTyprenClient(options)` | `(options: TyprenClientOptions) => TyprenClient` | The returned object satisfies `PageActions`, the same shape the UI already consumes, so switching a host from Server Actions to HTTP is a one-line change at the wiring site. |
| `TyprenApiError` | `class extends Error { status: number }` | |

| Option | Type | Default | Notes |
|---|---|---|---|
| `baseUrl` | `string` | required | Where the API is mounted, e.g. `"/api/typren"` or an absolute URL. |
| `fetch` | `typeof globalThis.fetch` | global `fetch` | Injectable for tests / non-browser runtimes. |
| `headers` | `Record<string, string>` | none | Merged into every request, e.g. auth headers for a token-authenticated host. |

`TyprenClient` extends `PageActions` with `listPages`, `getPage`, `renamePage`, `duplicatePage`, `listMedia`, `deleteMedia`, `uploadMedia`, `getSettings`, `saveSettingsDraft`, `publishSettings`, `writeBootstrap`, `listCollectionRecords`, and `collection(sectionId)` (a `PageActions` plus `getRecord` for one collection section).

### Errors

- Throws `TyprenApiError` (carrying the response status) on any non-ok HTTP response, so the caller can branch on `status` without it displacing the `SaveResult` union the action-shaped methods return.
- `collection(...).createTranslation`/`deleteTranslation` throw `typren: collection translations are not supported over HTTP`: the HTTP API has no `/translations` routes for collections.

## "./seo"

Metadata, sitemap, robots, JSON-LD, markdown mirror, and `llms.txt`/`llms-full.txt` generation. Next-only (several exports take Next's `Metadata`/`MetadataRoute` types).

| Export | Signature | Notes |
|---|---|---|
| `JsonLd({ data })` | `(props: { data: object }) => JSX.Element` | Renders a JSON-LD `<script>` tag, escaping `<` so a `</script>` can never break out of the script context. |
| `organizationJsonLd(config)` | `(config: SeoConfig) => object` | |
| `websiteJsonLd(config)` | `(config: SeoConfig) => object` | |
| `breadcrumbJsonLd(config, items)` | `(config: SeoConfig, items: { name: string; path: string }[]) => object` | `items` is ordered; pass `path: ""` for the first (Home) item so its `item` URL is the bare site root. |
| `collectSliceJsonLd(slices, registry?)` | `(slices: Slice[], registry?: Record<string, SliceJsonLd>) => object[]` | Unregistered slice names are silently skipped, not an error. |
| `buildRootMetadata(config)` | `(config: SeoConfig) => Metadata` | Root-layout `metadata` defaults. |
| `buildMetadata(page, slug, config, parent, i18n?, locale?)` | `(page: PageContent, slug: string, config: SeoConfig, parent: ResolvingMetadata, i18n?: I18nConfig, locale?: string) => Promise<Metadata>` | Never throws. With more than one locale, adds hreflang `alternates.languages` + x-default. |
| `buildSitemap(store, config, opts?)` | `(store: ContentStore, config: SeoConfig, opts?: BuildSitemapOptions) => Promise<MetadataRoute.Sitemap>` | One entry per page, honoring per-page `noindex`/`sitemap` overrides. Does not know about non-CMS collections; the host concats those itself. |
| `buildRobots(config)` | `(config: SeoConfig) => MetadataRoute.Robots` | |
| `DEFAULT_AI_CRAWLERS` | `readonly ["GPTBot", "ChatGPT-User", "ClaudeBot", "Claude-Web", "anthropic-ai", "PerplexityBot", "Google-Extended", "CCBot"]` | |
| `renderSlicesAsMarkdown(slices, overrides?)` | `(slices: Slice[], overrides?: SliceMarkdownRegistry) => string` | Best-effort generic slice-to-prose flattener; a slice that doesn't fit the common shape can be overridden per slice name. |
| `createMarkdownRouteHandler(store, renderOverrides?)` | `(store: ContentStore, renderOverrides?: SliceMarkdownRegistry) => { GET }` | Route Handler: `GET` returns `"# Title\n\n<flattened slices>"` as `text/markdown` for a known slug, 404 for unknown. |
| `createMarkdownMirrorMiddleware(mirrorPath)` | `(mirrorPath: string) => (request: NextRequest) => NextResponse` | Rewrites `/<slug>.md` to `<mirrorPath>/<slug>` so the route handler above serves it transparently. |
| `matchMarkdownMirrorSlug(pathname)` | `(pathname: string) => string \| null` | Matches `/some-slug.md` (single path segment); pure, no fs/req access. |
| `generateLlmsFullTxt(store, renderOverrides?)` | `(store: ContentStore, renderOverrides?: SliceMarkdownRegistry) => Promise<string>` | The always-fresh "llms-full.txt" companion to a hand-curated `llms.txt`; does not replace a curated summary file. |

`SeoConfig`: `{ siteUrl, siteName, entityDescription, defaultTitle, defaultDescription, titleTemplate?, bareTitleSlugs?, defaultOgImage?, organization?, aiCrawlers?, sliceJsonLd? }`. `PageSeoMeta` (per-page frontmatter): `{ title?, description?, ogImage?, canonical?, noindex?, keywords?, sitemap?: { priority?, changeFrequency?, lastModified? } }`. `SliceJsonLd<P>` is `(props: P) => object | object[] | null`; never throws on missing/malformed props, returns `null` instead.

### Errors

Nothing in `./seo` throws on bad content; malformed or missing fields degrade to defaults or `null` rather than failing a page render.

## "./auth/local"

The reference `AuthAdapter`: a dev-only gate.

| Export | Signature | Notes |
|---|---|---|
| `localAuth(opts?)` | `(opts?: { predicate?: () => boolean; allowInProduction?: boolean }) => AuthAdapter` | Refuses in production unless `allowInProduction` is explicitly set. Doesn't branch on `ctx.action`: `"admin"` gets the exact same local-only gate as every other write, since there is only one tier in local dev. |

| Option | Type | Default |
|---|---|---|
| `predicate` | `() => boolean` | `NODE_ENV === "development"` |
| `allowInProduction` | `boolean` | `false` |

### Errors

Does not throw; it returns `false` from `authorize()` whenever the predicate fails.

## "./auth/next-auth"

`AuthAdapter` over an existing NextAuth v5 session.

| Export | Signature | Notes |
|---|---|---|
| `nextAuthAdapter(opts)` | `(opts: { auth: () => Promise<Session>; allowedEmails?: string[]; allowedRoles?: string[]; adminRoles?: string[] }) => AuthAdapter` | `opts.auth` is the host's `auth` from `NextAuth(config)` (injected, not imported, matching how next-auth v5's `auth()` works inside server actions/components). |

| Option | Type | Default | Notes |
|---|---|---|---|
| `auth` | `() => Promise<Session>` | required | |
| `allowedEmails` | `string[]` | none | Case-insensitive match on `session.user.email`. |
| `allowedRoles` | `string[]` | none | Any-intersection with `session.user.roles`. |
| `adminRoles` | `string[]` | none | Any-intersection with `session.user.roles`, required for the `"admin"` action. Unmapped (no `adminRoles` configured) denies rather than falling back to `allowedRoles`. |

> **Security: default-open caveat.** With neither `allowedEmails` nor `allowedRoles` set, ANY signed-in user is authorized for ordinary content writes. Construction does **not** throw in this case (unlike `better-auth`/`supabase`/`oidc` below); require at least one allowlist yourself before this reaches production.

### Errors

Does not throw at construction. `authorize()` fails closed (returns `false`) on any error resolving the session.

## "./auth/clerk"

`AuthAdapter` over an existing Clerk session (optional peer `@clerk/nextjs`).

| Export | Signature | Notes |
|---|---|---|
| `clerkAuthAdapter(opts)` | `(opts: { allowedEmails?: string[]; allowedRoles?: string[]; allowedUserIds?: string[]; adminRoles?: string[]; organizationId?: string }) => AuthAdapter` | Clerk's `auth()`/`currentUser()` are global request-scoped helpers, so they're imported directly rather than injected. |

| Option | Type | Default | Notes |
|---|---|---|---|
| `allowedEmails` | `string[]` | none | Case-insensitive match on the user's verified primary email. |
| `allowedRoles` | `string[]` | none | Org role claim, e.g. `"org:admin"`. Requires `organizationId`. |
| `allowedUserIds` | `string[]` | none | |
| `adminRoles` | `string[]` | none | Org role the `"admin"` action requires on top of the ordinary allowlist. Requires `organizationId`. Unmapped denies. |
| `organizationId` | `string` | none | The Clerk org whose roles count. A role claim only counts while this org is the session's active org (v1 `org_id`, v2 `o.id`); v2's unprefixed `o.rol` is compared as `"org:<rol>"`. |

### Errors

Throws at construction if none of `allowedEmails`/`allowedRoles`/`allowedUserIds` is set, or if `allowedRoles`/`adminRoles` is set without `organizationId`. `authorize()` fails closed on any error resolving `auth()`.

## "./auth/better-auth"

`AuthAdapter` over an existing Better Auth session.

| Export | Signature | Notes |
|---|---|---|
| `betterAuthAdapter(opts)` | `(opts: { getSession: () => Promise<Session>; allowedEmails?: string[]; allowedRoles?: string[]; adminRoles?: string[]; rolesFrom?: (session) => string[] | undefined }) => AuthAdapter` | `getSession` is injected (e.g. `() => auth.api.getSession({ headers: await headers() })`), matching `next-auth`'s convention; this entry never resolves `better-auth` itself. |

| Option | Type | Default | Notes |
|---|---|---|---|
| `getSession` | `() => Promise<Session>` | required | |
| `allowedEmails` | `string[]` | none | Case-insensitive match on `session.user.email`; only read when `session.user.emailVerified === true`. |
| `allowedRoles` | `string[]` | none | |
| `adminRoles` | `string[]` | none | Required for `"admin"`; unmapped denies. |
| `rolesFrom` | `(session) => string[] \| undefined` | splits `session.user.role` on commas | Better Auth's admin plugin stores role as a single, sometimes comma-separated, string. |

> **Security:** requires an allowlist. `allowedEmails` or `allowedRoles` must be set, or construction throws, since a signed-in session with neither would authorize anyone who can sign in. Only a provider-verified email (`emailVerified === true`) can satisfy `allowedEmails`; an unverified email never matches, even if present.

### Errors

- Throws `typren: betterAuthAdapter requires an allowlist (allowedEmails or allowedRoles); without one any signed-in user could edit` at construction when both are empty.
- `authorize()` fails closed on any error resolving the session.

## "./auth/supabase"

`AuthAdapter` over an existing Supabase client.

| Export | Signature | Notes |
|---|---|---|
| `supabaseAuthAdapter(opts)` | `(opts: { client: SupabaseClient; allowedEmails?: string[]; allowedRoles?: string[]; adminRoles?: string[] }) => AuthAdapter` | Uses `client.auth.getUser()`, which revalidates the token against Supabase's server, deliberately not `getSession()`, which only reads the client-forgeable local cookie. |

| Option | Type | Default | Notes |
|---|---|---|---|
| `client` | `SupabaseClient` | required | The host's Supabase client, e.g. from `createServerClient(...)`. |
| `allowedEmails` | `string[]` | none | Only read when `email_confirmed_at` is set. |
| `allowedRoles` | `string[]` | none | Any-intersection with `app_metadata` roles. |
| `adminRoles` | `string[]` | none | Required for `"admin"`; unmapped denies. |

> **Security:** requires an allowlist, same as `better-auth`; construction throws without `allowedEmails` or `allowedRoles`. Roles are read ONLY from `user.app_metadata` (never `user_metadata`): Supabase lets the signed-in user write their own `user_metadata` from the client, so trusting it for authorization would let any user grant themselves roles. `app_metadata` is writable only via the service-role key, server-side. Only a confirmed email (`email_confirmed_at` set) can satisfy `allowedEmails`.

### Errors

- Throws `typren: supabaseAuthAdapter requires an allowlist (allowedEmails or allowedRoles); without one any signed-in user could edit` at construction when both are empty.
- `authorize()` fails closed on any error.

## "./auth/oidc"

Generic OIDC/JWT gate (peer `jose`), covering any IdP that hands the host a bearer JWT (Okta, Entra ID, Auth0, Keycloak, Google Workspace SSO), plus a Cloudflare Access preset.

| Export | Signature | Notes |
|---|---|---|
| `oidcAuthAdapter(opts)` | `(opts: OidcOpts) => AuthAdapter` | Verifies the signature against the issuer's remote JWKS (cached/rotated by `jose`'s `createRemoteJWKSet`, not refetched per request) plus `iss`/`aud`/`exp`. |
| `cfAccessAuthAdapter(opts)` | `(opts: { teamDomain: string; audience: string; getToken: () => Promise<string \| null>; rolesClaim?: string; emailClaim?: string; allowedEmails?: string[]; allowedRoles?: string[]; adminRoles?: string[] }) => AuthAdapter` | A Cloudflare Access preset over the same verification `oidcAuthAdapter` uses; issuer and JWKS URL are both derived from `teamDomain`. |

`OidcOpts`:

| Option | Type | Default | Notes |
|---|---|---|---|
| `getToken` | `() => Promise<string \| null>` | required | Reads the bearer token from the host's own request (e.g. the `Authorization` header). |
| `issuer` | `string` | required | Expected `iss` claim, and the default JWKS host. |
| `audience` | `string` | required | Expected `aud` claim. |
| `jwksUri` | `string` | resolved via OIDC discovery | When omitted, a lazy, cached-once fetch of `${issuer}/.well-known/openid-configuration` (5-second timeout) resolves it on the first `authorize()`/`getUser()` call. A discovery failure clears the cache so the next call retries instead of wedging the adapter open or closed. |
| `rolesClaim` | `string` | `"roles"` | Normalized to `string[]` (a bare string becomes `[value]`). |
| `emailClaim` | `string` | `"email"` | |
| `allowedEmails` | `string[]` | none | |
| `allowedRoles` | `string[]` | none | |
| `adminRoles` | `string[]` | none | Required for `"admin"`; unmapped denies. |

Verification requires `exp` and `sub` claims (`requiredClaims: ["exp", "sub"]`) and accepts asymmetric signature algorithms only.

> **Security:** `oidcAuthAdapter` requires an allowlist, same as `better-auth`/`supabase`; construction throws without `allowedEmails` or `allowedRoles`. `jwksUri`, if given explicitly, must still be `https:` when resolved via discovery (an `http:` JWKS endpoint would let a network attacker point verification at their own keys).
>
> **Security: `cfAccessAuthAdapter` is exempt** from the allowlist requirement: Access only issues its token after its own per-application policy already let the request through, so a verified token is already allowlisted by Access itself. `allowedRoles`/`adminRoles` only work when the team has SCIM group sync configured; without it every token omits the `groups` claim and these silently deny everyone rather than signal misconfiguration. `teamDomain` must be a bare hostname label (no scheme, slashes, or dots), enforced at construction.

### Errors

- `oidcAuthAdapter` throws `typren: oidcAuthAdapter requires an allowlist (allowedEmails or allowedRoles)`-shaped message at construction when both are empty.
- `cfAccessAuthAdapter` throws `typren: cfAccessAuthAdapter teamDomain must be a bare hostname label, got "<teamDomain>"` for a malformed `teamDomain`.
- Discovery throws `typren: OIDC discovery failed for <issuer> (<status>)`, `typren: OIDC discovery issuer mismatch for <issuer>`, or `typren: OIDC discovery document for <issuer> has no https jwks_uri` on a bad discovery document; the failure clears the cache so the next call retries.
- `authorize()`/`getUser()` fail closed on any verification error (wrong `iss`/`aud`, expired, malformed, discovery failure).

## "./templates/init"

| Export | Signature | Notes |
|---|---|---|
| `TYPREN_REWRITE_MARKER` | `"typren:admin-route-rewrite"` | |
| `TYPREN_BOOTSTRAP_MARKER` | `"typren:bootstrap-wired"` | |
| `buildTemplates(contentDirLiteral)` | `(contentDirLiteral: string) => Record<string, string>` | Every file `typren init` scaffolds, keyed by path relative to the detected project base dir. A key starting with `/` is project-root-relative regardless of base dir (`next.config.ts`, `typren.config.json`). |

### Errors

Does not throw; it returns plain template strings.

## "./github-webhook"

GitHub push-webhook handler, pairs with `createGithubAdapter`'s live-content caching. Web-standard `Request`/`Response`, mountable on Next Route Handlers, Workers, Lambda function URLs, or Hono.

| Export | Signature | Notes |
|---|---|---|
| `createGithubWebhookHandler(options)` | `(options: GithubWebhookOptions) => (req: Request) => Promise<Response>` | |

| Option | Type | Default | Notes |
|---|---|---|---|
| `secret` | `string` | required | Verifies `X-Hub-Signature-256`. Required: an unsecreted webhook is an unauthenticated endpoint that lets anyone trigger `onChange` by guessing the URL. |
| `branch` | `string` | `"main"` | Only a push to this branch triggers `onChange`; every other branch gets a 202 Accepted (ignored, not rejected). |
| `contentDir` | `string` | `"content"` | Must match the `createGithubAdapter` instance this webhook invalidates for. |
| `draftSubdir` | `string` | `"_drafts"` | Must match the adapter's own `draftSubdir`. A draft-only push never fires `onChange`, since draft reads are never cached. |
| `onChange` | `(change: GithubWebhookChange) => void \| Promise<void>` | required | Thrown errors become a 500 so GitHub retries/redelivers the webhook rather than silently losing the invalidation. |

`GithubWebhookChange`: `{ paths: string[]; slugs: string[]; locales: string[]; full: boolean }`. `full: true` means the push can't be enumerated reliably (a force push, or no commit list in the payload, including a payload at or over GitHub's 2048-commit-per-push cap): `paths`/`slugs`/`locales` are then empty and the host must invalidate ALL content.

The handler streams the request body with a 5MB cap (`MAX_BODY_BYTES`), bailing out mid-stream the moment the running byte count exceeds it, rather than trusting a possibly-absent `content-length` header (a chunked request carries none). It also dedupes on the `X-GitHub-Delivery` header, per handler instance (an in-memory `Map`, capped at 1000 recent ids), so a GitHub-retried or manually redelivered webhook 202s instead of invalidating twice.

> **Security:** the signature compare (`X-Hub-Signature-256` against an HMAC-SHA-256 of the body) is constant-time: it always walks every byte of the longer input rather than short-circuiting on the first mismatch or a length difference, so neither the signature's content nor its length leaks via timing.

### Errors

- Throws `typren: createGithubWebhookHandler requires a non-empty secret` at construction when `secret` is empty.
- The returned handler itself never throws; it maps a too-large body, a bad signature, or a non-matching branch to the appropriate HTTP response instead of throwing.

## "./theme.css"

The `--typren-*` CSS variable contract editor UI reads. Not a JS/TS export; import it for its side effect (`import "@typren/core/theme.css"`) wherever the editor UI is rendered.

## "./ui/*"

Vanilla (non-React) editor-UI helpers, used by `@typren/editor` and by any host rendering the preview bridge or i18n strings outside React.

| Export | Signature | Notes |
|---|---|---|
| `createT(messages?)` | `(messages?: Partial<Messages>) => (key: string, vars?: Record<string, string \| number>) => string` | Vanilla counterpart to `@typren/editor`'s `useT`: key to host-override to English-default to literal-key fallback, with `{var}` interpolation. A non-React consumer calls `createT(messages)` itself; no shared provider involved. |
| `defaultMessages` | `Messages` | English editor-UI strings shipped by the package, flat dot-namespaced keys. A host overrides any subset via `CmsConfig.i18n.messages[uiLocale]`. |
| `initPreviewBridge(allowedOrigin?)` | `(allowedOrigin?: string) => () => void` | Attaches the preview bridge's listeners and injects its stylesheet into `document.head` (once). Returns a cleanup function. Runs inside the preview iframe's own document, never the editor's shadow tree. |

> **Security:** `initPreviewBridge`'s `allowedOrigin` is the one origin the bridge will post to and accept messages from. Omitted, it defaults to `window.location.origin` (same-origin only, for local/self-host setups). A hosted dashboard framing a customer's site is cross-origin by definition and must pass its own origin explicitly; this is never `"*"`, the channel always compares against one explicit value.

### Errors

None of these throw.
