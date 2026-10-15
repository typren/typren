---
title: "@typren/editor reference"
description: Every export of @typren/editor, the React admin shell for pages, blocks and fields.
category: Reference
order: 52
---

This page documents the public exports of `@typren/editor`. See [architecture](./architecture.md) for the four-layer seam this package sits on top of.

> **Status:** `@typren/editor` is unpublished and `private: true`. Current scope is the Pages editing loop only; Settings, Media, Collections and onboarding UI are not built yet beyond what's listed below. `apps/studio` does not mount these components yet, and the `typren init` scaffold has not been rewritten against them. Test coverage is thin: the `./element` entry has a smoke suite, the rest of the package has none yet.

## "."

The React components themselves, `TyprenEditor` foremost. Depends on `@typren/core` for everything below the editor-UI seam (adapters, the draft/publish store, auth-gated action handlers) and owns nothing server-side itself.

| Export | Signature | Notes |
|---|---|---|
| `TyprenEditor` | `(props: TyprenEditorProps) => JSX.Element` | The one component a host mounts. Owns no router: `slug`/`sectionId`/`collectionSlug` are props, every navigation outcome is reported via `onNavigate`/`onNavigateSection`/`onNavigateCollection` instead of touching `window.location`. `host.sections` (omitted by default) switches it from the v1 Pages-only picker/shell to `SectionShell`, the SDUI section-switcher admin (Media/Collections/Settings/…); a host that never sets it keeps today's behavior byte-identical. |
| `TyprenEditorHost` (type) | see below | Everything host-specific injected in one object — the seam that lets a host mount the exact same package without drifting. |
| `TyprenEditorSettingsActions` (type) | `{ saveDraft(next, baseVersion?, locale?): Promise<SaveResult>; publish(baseVersion?, locale?): Promise<SaveResult>; writeBootstrap(patch): Promise<void> }` | Client-safe subset of core's `SettingsStore` the Settings section needs to write. |
| `EditorShell` | `(props) => JSX.Element` | The core Pages-editing-loop piece, exported individually for a host that composes its own layout. |
| `PagesNav`, `PageList`, `BlockList`, `DevicePreview`, `FieldForm` | `(props) => JSX.Element` | Individual Pages-loop pieces. |
| `ImagePickerField`, `FieldFormMedia` (type) | `(props) => JSX.Element` | `FieldForm`'s "image"/"media" control; degrades to a plain text input when `host.media` is omitted. |
| `IconPickerField`, `FieldFormIcons` (type) | `(props) => JSX.Element` | `FieldForm`'s "icon" control; degrades to a plain text input when `host.icons` is omitted. |
| `MediaGrid` | `(props) => JSX.Element` | Grid rendering for the Media section. |
| `SectionShell`, `SectionNav` | `(props) => JSX.Element` | SDUI section-switcher shell and its left rail. |
| `MediaLibrarySection` | `(props) => JSX.Element` | Media section content; hidden when `host.media` is omitted. |
| `SettingsPanel` | `(props) => JSX.Element` | Settings section content; hidden when `host.settings` is omitted. |
| `CollectionPanel`, `CollectionMode` (type) | `(props) => JSX.Element` | One Collection section's record UI. |
| `CollectionList`, `resolveListColumns` | `(props) => JSX.Element` / function | Collection section's list view. |
| `PreviewBridge` | `(props) => JSX.Element` | Mount in the host's preview route for the live-preview iframe bridge. |
| `initPreviewBridge` | re-exported from `@typren/core/ui/preview-bridge.vanilla` | For a host that wants to mount the bridge listener without React. |
| `CmsIntlProvider`, `useT` | `(props) => JSX.Element` / hook | Message/i18n context for the editor's own UI strings. |

**`TyprenEditorProps`:**

| Option | Type | Default | Notes |
|---|---|---|---|
| `host` | `TyprenEditorHost` | required | |
| `pages` | `PageInfo[]` | required | |
| `slug` | `string \| null` | `undefined` (page picker) | Page being edited. |
| `page` | `PageContent` | none | Required alongside `slug`; omitting it falls back to the page picker. |
| `version` | `string \| null` | none | Optimistic-lock version `page` was loaded at. |
| `locale` | `string` | none | Single-locale hosts omit this. |
| `layout` | `"takeover" \| "embedded"` | `"takeover"` | `"takeover"` is a fixed, full-viewport overlay; `"embedded"` renders in normal flow and the host owns page scroll/chrome. Native `<dialog>` pickers (image/icon) render in the top layer regardless. |
| `onNavigate` | `(slug: string \| null) => void` | required | |
| `onReload` | `() => void` | required | Refresh "this page" after a discard/publish/conflict-reload. |
| `messages` | `Partial<Messages>` | none | Deep-merged onto the package's English defaults. |
| `sectionId` | `string` | first resolved section | Only meaningful when `host.sections` is set. |
| `onNavigateSection` | `(id: string) => void` | none | Only called when `host.sections` is set. |
| `collectionRecords` | `Record<string, CollectionRecordInfo[]>` | none | Server-fetched rows per Collection section. |
| `collectionMode` / `collectionSlug` / `onNavigateCollection` | `CollectionMode` / `string` / `(mode, slug?) => void` | none | `CollectionPanel`'s controlled state; omit all three to keep it uncontrolled. |

**`TyprenEditorHost`:**

| Option | Type | Default | Notes |
|---|---|---|---|
| `actions` | `PageActions` | required | Auth-gated page CRUD/draft/publish handlers; bind to Server Actions or an equivalent RPC. |
| `sliceNames` | `string[]` | required | For `BlockList`'s "+ Add block" menu. |
| `defaults` | `Record<string, Record<string, unknown>>` | required | Starter props inserted when a slice is added. |
| `fieldSchema` | `Record<string, SliceSchema>` | none | Per-slice field hints. |
| `previewPath` | `string` | required | Route the editor iframes for live preview. |
| `media` | `FieldFormMedia` | none | Omit to degrade image fields to plain text and hide the Media section's content. |
| `icons` | `FieldFormIcons` | none | Omit to degrade the icon control to plain text. |
| `topBarSlot` | `ReactNode` | none | Host-injected chrome, rendered at the right of the shell's header. Only shown while a page is open. |
| `sections` | `Section[]` | none (v1 Pages-only picker) | Non-empty switches `TyprenEditor` to `SectionShell`. `"custom"` sections aren't rendered by this package; a host that declares one owns its own routing around it. |
| `collections` | `Record<string, PageActions>` | none | Only needed when `sections` includes a `"collection"` entry; an entry missing here renders read-only. |
| `settings` | `TyprenEditorSettingsActions` | none | Omit to hide the Settings section's content even when configured in `sections`. |

## "./element"

`<typren-shell>`, a custom element wrapping `TyprenEditor` for hosts that aren't React (Astro islands, a plain `<script type="module">`, …). Mounts the same React tree as `"."`, via `react-dom/client`, rendering into light DOM (no shadow root) since the shell's classes reference `@typren/core`'s `--typren-*` theme tokens, which the host page must load globally. Also registers `meditor-shell` as a deprecated alias for pre-rename consumers (logs a `console.warn` on connect, then behaves identically).

| Export | Signature | Notes |
|---|---|---|
| `TyprenShellElement` | `class extends HTMLElement` | Set properties (`host`, `pages`, `slug`, `page`, `version`, `locale`, `layout`, `messages`, `onNavigate`, `onReload`), not attributes — the data is objects/functions, which attributes can't carry. Re-renders once `host`, `pages`, `onNavigate` and `onReload` are all present; properties may be set before or after the element connects. |
| `TyprenShellHost` (type) | `Omit<TyprenEditorHost, "topBarSlot"> & { topBarSlot?: Node }` | Same shape as `TyprenEditorHost`, except `topBarSlot` takes a raw DOM `Node` (a non-React host can't produce JSX); `DomSlot` internally projects it into the React tree without cloning or serializing it. |

```ts
const el = document.createElement("typren-shell");
el.host = { actions, sliceNames, defaults, previewPath };
el.pages = pages;
el.onNavigate = (slug) => { /* ... */ };
el.onReload = () => { /* ... */ };
document.body.append(el);
```

## Errors

Neither entry throws from its own exported surface; `TyprenShellElement`'s setters simply skip rendering until `host`, `pages`, `onNavigate` and `onReload` are all present. `<meditor-shell>` prints a deprecation `console.warn` on `connectedCallback`.
