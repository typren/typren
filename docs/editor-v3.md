# Editor v3: drill-down shell with a full-bleed canvas

Status: spec, not yet built. Supersedes the v2 layout (left rail + block list
+ right Properties panel) for `@typren/studio`; the `TyprenStudioHost`
contract and core's `sections.ts` stay the seam, so hosts keep mounting the
same component.

## Hosting model: studio beside the site, not inside it

The editor runs as its own app, the way Storybook runs beside a component
library: `typren studio` starts `apps/studio` on its own port and frames the
site's real pages. The site keeps its whole URL space. It mounts no editor,
preview or API routes.

| Concern | Where it lives |
|---|---|
| Editor UI | `apps/studio`, a Next.js app mounting `@typren/studio` (the same app `typren init` scaffolds into a site today, run standalone instead). The framed site can use any framework. |
| Content reads and writes | The studio's own server, calling core's `ContentStore` on the site's content directory (or a remote adapter) directly. No HTTP API in the site. |
| Auth | The studio's server. `localAuth` binds to the studio process, which is always a plain Node server, so it never depends on the site's framework or output mode. |
| Preview | A preview-mode instance of the site's own dev command, which `typren studio` spawns as a child process on a side port (default studio port + 1, `TYPREN_PREVIEW=1`), framed cross-origin. The user's normal dev server is untouched and can run alongside. `--site-url` skips the spawn and frames a given URL instead. `previewUrl` is absolute (`http://127.0.0.1:3000/about/`), so the site's routing rules (trailing slash, locale prefixes) apply as-is. |
| Site integration | Two dev-only hooks: render drafts when `TYPREN_PREVIEW=1` (static-export sites cannot use a draft cookie), and include the bridge script plus `data-typren-index` slice markers. Production builds carry neither. |

The bridge already accepts an explicit `allowedOrigin` for cross-origin
framing; the studio passes its own origin through the site's dev config.

Consequences: the in-site `/editor` route and `adminRoute` become optional
(kept for hosts that want an embedded admin), the site no longer needs the
editor package as a dependency, and the hosted platform frames customer sites
the same way.

Live preview of unsaved edits works as today: autosave writes a draft, the
frame reloads with scroll restored.

## Principle

The preview is the editor. It always fills the main area. Everything else is
either a narrow left rail that drills down one level at a time, or chrome
floating over the canvas. Nothing permanently takes width from the page.

## Naming

The wireframes call a page's slices "sections". Core already uses `Section`
for an admin rail entry (`sections.ts`). In the UI, a page slice is labelled
**Section**. In code and in this doc it stays a **slice**; rail entries stay
`Section`. No type renames.

## Layout (every screen)

| Region | Contents |
|---|---|
| Rail header (top left) | Root: the product name. Drilled in: a back chevron plus the parent's label (`< Website`, `< Pages`). |
| Action bar (top, left of centre) | Browse mode: **Edit**. Edit mode: **Save Draft** and **Discard**. |
| Page pill (top centre) | Current page title, its URL, and its status (`Published`, `Draft`, `Unpublished changes`). |
| Device toggle (top right) | Mobile / tablet / desktop. Global, not per page. |
| Main area | A website rail entry: the live preview of the current page. Any other rail entry (Media, Collections, Settings, custom): that entry's own full page, in the same rounded frame. |

## Rail levels

### Level 0: site

- Site name (`settings.brand.name`).
- Groups come from resolved sections, collapsible, in config order. The
  built-in group is **Website** (`group: "website"`): Pages, Style, Assets,
  Templates (SEO fields live in Settings until SEO & AIO gets its own
  section kind). Host-declared groups (`group: "<anything>"`) render
  after it with their own label; their entries open in the main area.
- Default for a host that configures no sections: Website → Pages only.

### Level 1: Pages (`< Website`)

- Title **Pages** with a `+` that opens the new-page wizard, a centred
  dialog asking one question a step: the title, the location (the site root
  or any page or folder), the slug segment (pre-filled from the title,
  checked against its siblings), how to start (blank, a page template, or
  sections assembled in a sandbox with a stacked preview), then a review.
  **Only a folder** asks just the location and name. New pages start as
  drafts and open in edit mode.

### Level 1: Templates (`< Website`)

- Two rows: **Sections** (saved sections plus built-in slice types) and
  **Pages** (page templates: named, ordered groups of sections, kept in
  `.typren/library.md` beside saved sections). Both browse as a gallery or
  list; a page template's viewer edits its sections and starts a new page
  from it.
- The home page (`homeSlug`) is pinned first, above and outside the groups.
- Collapsible page groups, first match wins:
  - **Drafts**: pages that were never published (`published: false`).
  - **System Pages**: pages with `system: true` (404 and the like).
  - **Hidden from search**: pages with `noindex: true`.
  - **In navigation**: pages linked from the site doc's header navigation
    (`site.md`'s `nav` items and their `children`, then its `cta`), in that
    order; a page's own `nav`/`navOrder` front matter overrides it.
  - **Not in navigation**: everything else.

  The rail lists them In navigation, Not in navigation, Hidden from search,
  System Pages, Drafts. A published page with a pending draft stays in its
  group with a dot.
- Each group is a tree of slug segments: `event/1` sits under `event`, behind
  a disclosure chevron. A segment with no page of its own in that group is a
  folder. Folders are implied by nested slugs; an empty one made in the
  wizard is kept by a `.typren-folder` marker file, which the local studio
  commits with the next Save. A kept folder can be deleted while empty.
- Clicking a page previews it in browse mode. **Edit** enters level 2.

### Level 2: page (`< Pages`)

- Title is the page title, with a `+` (add a section at the end).
- The page's slices as a list, labelled by slice name (or a `label` prop if
  the slice has one). Clicking one selects it and scrolls the canvas to it.
- Action bar switches to Save Draft / Discard. Leaving level 2 with unsaved
  edits asks first.

## Canvas editing (level 2)

Hovering or selecting a slice in the canvas draws, over the iframe:

- A 2px primary-colour outline around the slice.
- An **Add section** pill centred on its top edge: inserts a slice above.
- Top-left inside the slice: a layers button (opens the level-2 list focused
  on this slice) and **Add block** (deferred, see Phases).
- Top-right floating toolbar:
  - **Edit section**: opens the slice's `FieldForm` in a popover anchored to
    the toolbar (native `<dialog>` or a top-layer popover, so no z-index
    coordination).
  - **View layouts**: lists the slice's layout variants (deferred).
  - Duplicate, Save to Sections (heart), Move up, Move down.
  - **Remove** (destructive colour).

The overlay is drawn by the editor, not inside the iframe. The bridge posts
geometry up; the editor positions chrome over the frame. This keeps editor UI
out of the site's document and its CSS.

### Bridge additions (`preview-bridge.vanilla.ts`)

Additive messages, same origin rules as today:

- iframe → editor `rects`: `{ index, top, left, width, height }[]` for every
  `[data-typren-index]`, posted on load, resize, scroll and after DOM changes
  (one `ResizeObserver` plus a `scroll` listener, coalesced per frame).
- iframe → editor `hover`: `{ index | null }`.
- Existing `select`, `edit`, `theme`, `scrollTo` unchanged.

The device toggle changes the frame width; rects re-post on resize, so the
overlay follows.

## Preview URL

The preview iframe `src` must respect the host's trailing-slash convention.
Add `TyprenStudioHost.previewUrl?: (slug: string) => string`; when omitted,
fall back to today's `${previewPath}/${slug}`. A host on `trailingSlash: true`
returns `${previewPath}/${slug}/`. Sandboxed frames do not reliably follow
the redirect otherwise.

## Data needed from core

- `PageInfo` gains optional `nav?: boolean`, `navOrder?: number`,
  `system?: boolean`, read from front matter by the content adapter. All
  optional: a page without them lands in Other Pages.
- `isHome` is derived in the editor from the host's home slug
  (`TyprenStudioHost.homeSlug?: string`, default `"home"`).
- New section kinds for Style and SEO & AIO are **not** part of phase 1:
  until they exist, those rail entries render only when a host configures
  them as `custom` sections.

## Style

Website → Style edits `SiteSettingsRuntime.style`, a record of `--typren-*` custom
property to value (the catalogue is `STYLE_TOKENS`: colours, fonts, sizes, line
heights, type scale, radius, spacing). It drills into three screens, Colors, Type
and Shape. Each opens on a gallery (a palette with contrast readings, a type
specimen, drawn shapes) that uses the asset gallery's selection; the selected
item's settings open in a floating panel on the right. The draft is shared by
the three screens, and its controls sit in the top bar's action slot: Save,
Discard, then Publish, or Review with a local git checkout (the shared Review
panel, which pushes or discards saved files one by one).

A site consumes the published tokens by inlining `styleCss(settings.style, map)`
(see docs/site/theming.md): each token under its own name and the site property
`studio.style` maps it to, shadcn names by default. While editing, the screen
posts the same declarations to the preview frame (bridge `style` message), so the
site restyles without a save, and asks the frame for the site's own values
(bridge `computedStyle`), which it shows for every unset token. "Preview site"
shows that frame in place of the gallery, with the settings panel still open.

## Phases

0. **Studio host.** `apps/studio` as a runnable app plus a `typren studio`
   CLI command: own server over `ContentStore`, `localAuth` on that process,
   site URL from config, absolute `previewUrl`. Site-side draft flag and
   bridge include documented for Next.js. Independent of phase 1's UI.
1. **Shell.** Rail levels 0 to 2, action bar, page pill, global device
   toggle, full-bleed canvas, non-website entries in the main area, page
   groups, `previewUrl`. The v2 Properties panel moves into the Edit section
   popover. Block list moves to the level-2 rail.
2. **Canvas overlay.** Bridge `rects`/`hover`, outline, Add section pill,
   floating toolbar (edit, duplicate, move, remove).
3. **Library and variants.** Sections library (heart, Website → Sections),
   View layouts, Style (the `--typren-*` token set), SEO & AIO, nested
   blocks inside a section (needs a slice data-model change; separate spec).

## Out of scope

Collaboration, comments, version history, undo beyond the existing
draft/discard.
