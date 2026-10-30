---
title: "@typren/studio reference"
description: Every export of @typren/studio, the React UI for pages, blocks and fields.
category: Reference
order: 52
---

This page documents the public exports of `@typren/studio`. See [architecture](./architecture.md) for the four-layer seam this package sits on top of.

> **Status:** `@typren/studio` is unpublished and `private: true`. The shell and the canvas overlay are phases 1 and 2 of the v3 layout in [editor-v3.md](../editor-v3.md); the sections library, layouts and Style/SEO entries (phase 3) are not built.
>
> `apps/studio` mounts `TyprenStudio` as a standalone Next.js app (see [Studio](./studio.md)); sites themselves no longer mount it.

## Layout

The preview fills the main area; everything else is a narrow left rail that drills down one level at a time, plus chrome along the top.

| Region | Contents |
|---|---|
| Rail header | `Typren` at the root; a back chevron plus the parent's label once drilled in (`< Website`, `< Pages`). |
| Action bar | Browse mode: **Edit** (enabled once `page` is loaded). Edit mode autosaves; it shows the save status, which opens the page's version history when `host.git.history` is set, then **Review** on hosts with `host.git`, else **Discard** and **Publish**. |
| Page pill | The open page's title, its URL (`/` for the home page) and its status. |
| Device toggle | Mobile / tablet / desktop, global across pages. Hidden for entries without a preview. |
| Main area | Website entries: the live preview of `slug`. Media, Settings, Collection and custom entries: that entry's own panel. |

Rail levels:

- **Level 0, site.** `settingsSnapshot.brand.name`, then the resolved `host.sections` as collapsible groups. Pages always sits in **Website**, which comes first; other groups follow in config order. With no `sections`, the rail is Website → Pages only.
- **Level 1, Pages.** A `+` opens a wizard for a new page: its location (root, or any page or folder), slug segment, title, or a folder only; new pages start as drafts. The `homeSlug` page is pinned first, outside the groups. Then **In navigation** (linked from the published `site.md`'s `nav` or `cta`, in that order; on a site doc without `nav`, `nav: true` in the page's front matter), **Not in navigation**, **Hidden from search** (`noindex: true`), **System Pages** (`system: true`) and **Drafts** (never published). These flags come from front matter via `PageInfo`. Each group is a tree of slug segments with disclosure chevrons. The `homeSlug` page shows a house icon. Clicking a page calls `onNavigate`; the preview follows `slug`.
- **Level 1, Navigation.** A `custom` section with `id: "navigation"`: the site doc's menu as a tree, edited beside a preview of the home page. See [Navigation](./navigation.md).
- **Level 2, page (edit mode).** The page title, an add-section control and the page's slices, labelled by a slice's `label` prop or its slice name. Over the preview, the canvas overlay outlines the hovered and selected slices and gives the active one an Add section pill (inserts above), a button that focuses its rail row, and a toolbar: Edit section, Duplicate, Move up, Move down and Remove (after a confirm). View layouts and Save to Sections show disabled until phase 3. Edit section opens the slice's `FieldForm` in a popover anchored to the toolbar; selecting a slice in the rail opens it too, while clicking one on the canvas only selects it. The overlay draws from the `rects` and `hover` messages the preview bridge posts. Edits autosave to the draft after 0.8s and reload the preview. Going back with edits not yet saved asks first.

## "."

The React components themselves, `TyprenStudio` foremost. Depends on `@typren/core` for everything below the studio-UI seam (adapters, the draft/publish store, auth-gated action handlers) and owns nothing server-side itself.

| Export | Signature | Notes |
|---|---|---|
| `TyprenStudio` | `(props: TyprenStudioProps) => JSX.Element` | The one component a host mounts. Owns no router: `slug`/`sectionId`/`collectionSlug` are props, and every navigation outcome is reported via `onNavigate`/`onNavigateSection`/`onNavigateCollection`. Rail depth and browse/edit mode are internal UI state. The root fills its parent (`h-full`), so the mount point needs a definite height. |
| `TyprenStudioHost` (type) | see below | Everything host-specific injected in one object. |
| `TyprenStudioSettingsActions` (type) | `{ saveDraft(next, baseVersion?, locale?): Promise<SaveResult>; publish(baseVersion?, locale?): Promise<SaveResult>; discardDraft?(locale?); hasDraft?(locale?); history?(locale?); writeBootstrap?(patch): Promise<void> }` | Client-safe subset of core's `SettingsStore` the Settings and Style entries need. They autosave to one draft; `discardDraft` enables Discard, `history` the save status's version history. |
| `BlockList`, `FieldForm` | `(props) => JSX.Element` | The level-2 slice list and the slice field form. |
| `DevicePreview`, `DeviceToggle`, `Device` (type) | `(props) => JSX.Element` | The sandboxed preview frame at a device width, and the top-bar switcher. |
| `ImagePickerField`, `FieldFormMedia` (type) | `(props) => JSX.Element` | `FieldForm`'s "image"/"media" control; degrades to a plain text input when `host.media` is omitted. |
| `IconPickerField`, `FieldFormIcons` (type) | `(props) => JSX.Element` | `FieldForm`'s "icon" control; degrades to a plain text input when `host.icons` is omitted. |
| `MediaGrid` | `(props) => JSX.Element` | Asset grid shared by the Media entry and the image picker. |
| `MediaLibrarySection` | `(props) => JSX.Element` | Media entry content; a notice when `host.media` is omitted. |
| `SettingsPanel` | `(props) => JSX.Element` | Settings entry content; a notice when `host.settings` is omitted. |
| `CollectionPanel`, `CollectionMode` (type) | `(props) => JSX.Element` | One Collection entry's record UI. |
| `CollectionList`, `resolveListColumns` | `(props) => JSX.Element` / function | Collection entry's list view. |
| `PreviewBridge` | `(props) => JSX.Element` | Mount in the previewed site for the live-preview iframe bridge. |
| `initPreviewBridge` | re-exported from `@typren/core/ui/preview-bridge.vanilla` | For a host that wants to mount the bridge listener without React. |
| `CmsIntlProvider`, `useT` | `(props) => JSX.Element` / hook | Message/i18n context for the studio's own UI strings. |

**`TyprenStudioProps`:**

| Option | Type | Default | Notes |
|---|---|---|---|
| `host` | `TyprenStudioHost` | required | |
| `pages` | `PageInfo[]` | required | |
| `slug` | `string \| null` | none | Page previewed, and edited once in edit mode. |
| `page` | `PageContent` | none | `slug`'s content; edit mode needs it. A new `version` after `onReload` restarts the studio from it. |
| `version` | `string \| null` | `null` | Optimistic-lock version `page` was loaded at. |
| `locale` | `string` | none | Single-locale hosts omit this. |
| `onNavigate` | `(slug: string \| null) => void` | required | |
| `onReload` | `() => void` | required | Refresh the host's data after a discard/publish/conflict-reload. |
| `messages` | `Partial<Messages>` | none | Merged onto the package's English defaults. |
| `sectionId` | `string` | first resolved section | Active rail entry. |
| `onNavigateSection` | `(id: string) => void` | none | Called when a level-0 entry is opened. |
| `collectionRecords` | `Record<string, CollectionRecordInfo[]>` | none | Server-fetched rows per Collection entry. |
| `collectionMode` / `collectionSlug` / `onNavigateCollection` | `CollectionMode` / `string` / `(mode, slug?) => void` | none | `CollectionPanel`'s controlled state; omit all three to keep it uncontrolled. |
| `settingsSnapshot` / `settingsVersion` | `SiteSettings` / `string \| null` | none | Settings entry data, its draft when there is one; `brand.name` is also the site name at level 0. |
| `settingsHasDraft` | `boolean` | `false` | `settingsSnapshot` is a draft not published yet. |

**`TyprenStudioHost`:**

| Option | Type | Default | Notes |
|---|---|---|---|
| `actions` | `PageActions` | required | Auth-gated page CRUD/draft/publish handlers; bind to Server Actions or an equivalent RPC. |
| `sliceNames` | `string[]` | required | For the level-2 add-section control. |
| `defaults` | `Record<string, Record<string, unknown>>` | required | Starter props inserted when a slice is added. |
| `fieldSchema` | `Record<string, SliceSchema>` | none | Per-slice field hints. |
| `previewPath` | `string` | required | The preview frame loads `${previewPath}/${slug}` unless `previewUrl` is set. |
| `previewUrl` | `(slug: string) => string` | none | Overrides `previewPath`. May be absolute and cross-origin (`http://127.0.0.1:3000/about/`), so a studio can frame the site's own dev server. Return the site's canonical form, trailing slash included: sandboxed frames do not reliably follow the redirect. The studio appends `v` (cache-buster) and `locale` query parameters. |
| `homeSlug` | `string` | `"home"` | Shown with a house icon and as `/` in the page pill. |
| `media` | `FieldFormMedia` | none | Omit to degrade image fields to plain text and show a notice in the Media entry. |
| `icons` | `FieldFormIcons` | none | Omit to degrade the icon control to plain text. |
| `topBarSlot` | `ReactNode` | none | Host-injected chrome, rendered at the right of the top bar. |
| `sections` | `Section[]` | Website → Pages | Rail entries. `"custom"` entries aren't rendered by this package; the host renders those itself. |
| `collections` | `Record<string, PageActions>` | none | Only needed when `sections` includes a `"collection"` entry; an entry missing here renders read-only. |
| `settings` | `TyprenStudioSettingsActions` | none | Omit to show a notice in the Settings entry even when configured in `sections`. |

## "./element"

`<typren-shell>`, a custom element wrapping `TyprenStudio` for hosts that aren't React (Astro islands, a plain `<script type="module">`, …). Mounts the same React tree as `"."`, via `react-dom/client`, rendering into light DOM (no shadow root) since the shell's classes reference `@typren/core`'s `--typren-*` theme tokens, which the host page must load globally. The shell fills the element, so give it a definite height.

| Export | Signature | Notes |
|---|---|---|
| `TyprenShellElement` | `class extends HTMLElement` | Set properties (`host`, `pages`, `slug`, `page`, `version`, `locale`, `messages`, `onNavigate`, `onReload`), not attributes — the data is objects/functions, which attributes can't carry. Re-renders once `host`, `pages`, `onNavigate` and `onReload` are all present; properties may be set before or after the element connects. |
| `TyprenShellHost` (type) | `Omit<TyprenStudioHost, "topBarSlot"> & { topBarSlot?: Node }` | Same shape as `TyprenStudioHost`, except `topBarSlot` takes a raw DOM `Node` (a non-React host can't produce JSX); `DomSlot` internally projects it into the React tree without cloning or serializing it. |

```ts
const el = document.createElement("typren-shell");
el.host = { actions, sliceNames, defaults, previewPath };
el.pages = pages;
el.onNavigate = (slug) => { /* ... */ };
el.onReload = () => { /* ... */ };
document.body.append(el);
```

## Errors

Neither entry throws from its own exported surface; `TyprenShellElement`'s setters simply skip rendering until `host`, `pages`, `onNavigate` and `onReload` are all present.
