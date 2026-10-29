---
"@typren/studio": minor
---

The v3 studio. The UI package is now `@typren/studio` (was `@typren/editor`), and its product-sense names say studio: `TyprenEditor` is `TyprenStudio`, with `TyprenStudioProps`, `TyprenStudioHost` and `TyprenStudioSettingsActions`. Neither package had been published, so no alias is kept.

- **Shell.** One app shell for studio local and the cloud dashboard, built from vendored Base UI primitives and the `--typren-*` theme: a collapsible site rail that becomes a drawer on small screens, a top bar with search and a device toggle, a light/dark selector, skeletons that hold the layout while screens load, and one themed confirm dialog.
- **Pages.** Edit mode runs on the site's persistent page canvas, so page switches, edits and reorders no longer reload the preview, with section outlines drawn inside the page. Pages nest in folders, get a settings popover per rail row and are created from a new-page wizard.
- **Autosave and Review.** Pages, Navigation, Settings and Style autosave and show when they last saved; hovering shows the version history as a commit timeline. Review lists the saved files waiting to be pushed and pushes one commit per page.
- **Screens.** Navigation edits the header menu; Style edits colours (with a custom picker), type and shape and restyles the preview as you type; Settings edits the site settings; Assets browses media in folders with drag and drop and a viewer; Templates and the Sections library show saved sections and page templates as the site renders them.
- **Accessibility.** Fixes from a WCAG 2.2 AA audit: labelled fields, modal viewers, roving focus, one live region for save and push status, 3:1 control edges and reduced-motion support.
