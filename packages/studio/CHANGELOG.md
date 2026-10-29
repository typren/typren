# @typren/studio

## 0.6.0

### Minor Changes

- c1dbf54: The v3 studio. The UI package is now `@typren/studio` (was `@typren/editor`), and its product-sense names say studio: `TyprenEditor` is `TyprenStudio`, with `TyprenStudioProps`, `TyprenStudioHost` and `TyprenStudioSettingsActions`. Neither package had been published, so no alias is kept.
  
  - **Shell.** One app shell for studio local and the cloud dashboard, built from vendored Base UI primitives and the `--typren-*` theme: a collapsible site rail that becomes a drawer on small screens, a top bar with search and a device toggle, a light/dark selector, skeletons that hold the layout while screens load, and one themed confirm dialog.
  - **Pages.** Edit mode runs on the site's persistent page canvas, so page switches, edits and reorders no longer reload the preview, with section outlines drawn inside the page. Pages nest in folders, get a settings popover per rail row and are created from a new-page wizard.
  - **Autosave and Review.** Pages, Navigation, Settings and Style autosave and show when they last saved; hovering shows the version history as a commit timeline. Review lists the saved files waiting to be pushed and pushes one commit per page.
  - **Screens.** Navigation edits the header menu; Style edits colours (with a custom picker), type and shape and restyles the preview as you type; Settings edits the site settings; Assets browses media in folders with drag and drop and a viewer; Templates and the Sections library show saved sections and page templates as the site renders them.
  - **Accessibility.** Fixes from a WCAG 2.2 AA audit: labelled fields, modal viewers, roving focus, one live region for save and push status, 3:1 control edges and reduced-motion support.

### Patch Changes

- Updated dependencies [c1dbf54]
  - @typren/core@0.6.0

## 0.5.4

### Patch Changes

- Updated dependencies [6da1d23]
- Updated dependencies [ddc554b]
  - @typren/core@0.5.4

## 0.5.3

### Patch Changes

- Updated dependencies [a30827e]
- Updated dependencies [5dc7a16]
- Updated dependencies [121d0c1]
- Updated dependencies [5ea6713]
- Updated dependencies [5c11512]
  - @typren/core@0.5.3

## 0.5.2

### Patch Changes

- Updated dependencies [20e0cf5]
- Updated dependencies [2272c4b]
- Updated dependencies [1aa05a6]
- Updated dependencies [e860046]
- Updated dependencies [7489416]
- Updated dependencies [8f9c06e]
  - @typren/core@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies [e78fa80]
- Updated dependencies [d8b5925]
- Updated dependencies [dc12381]
- Updated dependencies [38ee2d8]
- Updated dependencies [8db92cc]
- Updated dependencies [bd91499]
- Updated dependencies [1d632a0]
- Updated dependencies [7183ffa]
  - @typren/core@0.5.1

## 0.5.0

### Patch Changes

- c816b3f: The live-preview iframe is now sandboxed (`allow-scripts allow-forms`, no `allow-same-origin`), so script in
  draft content runs in an opaque origin and cannot reach the editor's session. The editor accepts bridge messages
  only from its own preview frame. A preview route whose code reads `localStorage`/`document.cookie` must tolerate
  those throwing, and fonts served to it need CORS headers.
- Updated dependencies [b0aa508]
- Updated dependencies [d2c9f03]
- Updated dependencies [11b4619]
- Updated dependencies [3e432fe]
- Updated dependencies [07a5280]
- Updated dependencies [52e172a]
- Updated dependencies [1130d81]
- Updated dependencies [e20d2b8]
- Updated dependencies [f5ec0c8]
- Updated dependencies [f5580aa]
- Updated dependencies [b95f3cd]
- Updated dependencies [c6f38fa]
- Updated dependencies [8be319f]
- Updated dependencies [87ec75b]
- Updated dependencies [d054689]
  - @typren/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [7e13dc1]
  - @typren/core@0.4.0

## 0.3.3

### Patch Changes

- Updated dependencies [aa2ebce]
  - @typren/core@0.3.3

## 0.3.2

### Patch Changes

- @typren/core@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [ff519d8]
  - @typren/core@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies [4a519e8]
- Updated dependencies [fdb04a5]
  - @typren/core@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies [e7c422f]
  - @typren/core@0.2.2

## 0.2.1

### Patch Changes

- 2a16e28: `CollectionPanel` accepts optional `mode`/`selectedSlug` props and an `onNavigate` callback so a host can control which collection record is open (e.g. a `?record=<slug>&mode=edit` URL), mirroring the existing `onReload` convention. Omitting all three keeps the previous uncontrolled behavior. `SectionShell` and `TyprenEditor` forward the same three as `collectionMode`/`collectionSlug`/`onNavigateCollection`.
- @typren/core@0.2.1
