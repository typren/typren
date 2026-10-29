---
package: "@typren/core"
version: "0.6.0"
title: "The editor runs in typren studio, not inside the site"
detect:
  - pattern: "TYPREN_REWRITE_MARKER"
    glob: "**/*.{ts,tsx,mjs,js}"
    hint: "@typren/core/templates/init no longer exports TYPREN_REWRITE_MARKER; the admin-route rewrite it marked is gone."
  - pattern: "typren:admin-route-rewrite"
    glob: "next.config.*"
    hint: "Remove the scaffolded admin-route rewrite from next.config; the editor no longer lives on a site route."
  - pattern: "\"adminRoute\""
    glob: "typren.config.json"
    hint: "typren init no longer writes adminRoute; the site has no editor route to name."
  - pattern: "createTyprenApi\\(|from\\s+[\"']@typren/editor[\"']"
    glob: "**/app/**/*.{ts,tsx}"
    hint: "Editor, preview and content-API routes inside the site are replaced by typren studio, which serves them from its own process. Delete these routes once the studio works for you."
  - pattern: "typrenBlocksDirectEditorAccess"
    glob: "**/*.{ts,tsx,mjs,js}"
    hint: "Renamed to typrenBlocksDirectStudioAccess; the admin route is now /studio."
  - pattern: "typrenProxyRewrite"
    glob: "**/proxy.{ts,js}"
    hint: "The proxy now rewrites a renamed adminRoute to /studio/**, not /editor/**. Move app/editor to app/studio."
---
## What changed

The editor now runs as a standalone Next.js app, `typren studio`, beside the
site instead of inside it, the way Storybook runs beside a component library.
It serves the editor and the content API from its own process, and spawns the
site's own dev command in preview mode on a side port to frame it.

`typren init` scaffolds the site side only. It no longer writes the
admin-route rewrite in `next.config.ts`, `cms-actions.ts`,
`app/media/upload/route.ts` or `adminRoute` in `typren.config.json`.
`@typren/core/templates/init` drops the `TYPREN_REWRITE_MARKER` export, and
`typren apply-settings` no longer creates or checks `next.config.*`.

Init adds two dev-only preview hooks instead: drafts render when the dev
server runs with `TYPREN_PREVIEW=1`, and `slices/studio-bridge.tsx` mounts the
preview bridge plus `data-typren-index` wrappers in that mode only.
Production builds carry neither.

## Fix

1. Remove the admin-route rewrite from `next.config.*` and any `adminRoute`
   key from `typren.config.json`.
2. Add the preview hooks from [the studio guide](../site/studio.md): a
   `TYPREN_PREVIEW=1` branch that reads drafts, and the studio bridge in your
   slice renderer.
3. Run `typren studio` and confirm you can edit and preview pages.
4. Delete the in-site editor, preview and content-API routes and their
   `@typren/editor` imports.

## Verify

`typren studio` opens the editor on its own port and shows your pages in the
preview, and `next build` output contains no editor or preview routes.

## The admin route is now /studio

Studio is the product's one name, so core's admin route follows it.

- `adminRoute` defaults to `"studio"` (was `"editor"`), so the default
  route and preview path are `/studio/**` and `/studio/preview`.
- `typrenProxyRewrite` rewrites a renamed `adminRoute` to `/studio/**`
  (was `/editor/**`).
- `typrenBlocksDirectEditorAccess` is renamed `typrenBlocksDirectStudioAccess`
  and blocks `/studio/**` once the route is renamed.
- `currentAdminRoute`, `typrenProxyRewrite` and `previewPathFor` keep their
  names.

Who is affected: a site that still serves admin routes from `app/editor`
and either relies on the default route or wires the proxy helpers, and code
importing `typrenBlocksDirectEditorAccess`. A site that sets `adminRoute`
itself and does not wire the proxy is unaffected: the stored value wins.

### Fix

1. Replace `typrenBlocksDirectEditorAccess` with
   `typrenBlocksDirectStudioAccess` in every import and call.
2. Pick one:
   - Move `app/editor` to `app/studio`. The route is then `/studio`.
   - Or keep the `/editor` URL: set `"adminRoute": "editor"` in
     `typren.config.json`. Without the proxy helpers, leave `app/editor`
     where it is. With them, still move `app/editor` to `app/studio`: the
     proxy rewrites `/editor/**` to the real `/studio/**` routes.

### Verify

The admin route opens at `/studio` (or at your `adminRoute`), its preview
loads, and `tsc` finds no `typrenBlocksDirectEditorAccess`.
