---
title: Project anatomy
description: Every file npx typren init writes, and what each one does.
category: Start
order: 2
---

`npx typren init` writes a fixed set of files relative to your project's
detected base dir (`src/` if you have `src/app`, otherwise the project root).
Two files always land at the project root regardless of that base dir:
`typren.config.json` and `next.config.ts`.

## `typren.config.json` (project root)

```json
{
  "adminRoute": "editor",
  "locales": ["en"],
  "defaultLocale": "en",
  "routing": "prefix-except-default",
  "onboarded": false
}
```

The bootstrap tier: which URL segment the (future) editor mounts under, which
locales exist, and the default locale's routing. Read via
`createFsSettingsAdapter({ file }).readBootstrap()`. Edit this by hand, then
run `npx typren apply-settings` to reconcile `next.config.ts` and
`cms.config.ts` against it.

## `next.config.ts` (project root)

Imports `typren.config.json` and adds a rewrite from `/${adminRoute}/:path*`
to `/editor/:path*`. Carries a `typren:admin-route-rewrite` marker comment
that `typren apply-settings` greps for to confirm it's already wired, without
parsing the file as TypeScript. If you already had a `next.config.*`,
`init`/`apply-settings` never touch it; they print the rewrite to add by
hand instead.

## `cms.config.ts`

The one object that wires Typren into your project:

```ts
export const cmsConfig: CmsConfig = {
  registry,
  defaults,
  fieldSchema,
  adapter: createMarkdownAdapter({
    contentDir,
    draftDir: path.join(contentDir, ".drafts"),
    locales: bootstrap.locales,
    defaultLocale: bootstrap.defaultLocale,
  }),
  previewPath: "/editor/preview",
  auth: localAuth(),
  mediaAdapter: createFsMediaAdapter({ dir: path.join(process.cwd(), "public/img"), publicPath: "/img" }),
};

export const cmsStore = createStore(cmsConfig.adapter, { onPublish: cmsConfig.onPublish });
```

- **`adapter`** — a `createMarkdownAdapter` instance over `<baseDir>/content`
  (the fs + markdown `ContentAdapter`; see [Content tiers](./content-tiers.md)
  for the GitHub-backed alternative).
- **`auth: localAuth()`** — authorizes writes only when
  `NODE_ENV === "development"`; fails closed in production. Swap for
  `@typren/core/auth/next-auth`, `/clerk`, `/better-auth`, `/supabase`, or
  `/oidc` before deploying — see [Auth model](./auth-model.md).
- **`mediaAdapter`** — `createFsMediaAdapter` over `public/img`, serving
  uploads at `/img/*`.
- **`previewPath`** — a stable target for a future editor preview route;
  nothing renders it in this scaffold.

`cmsConfig.ts` carries a `typren:bootstrap-wired` marker comment, the
`apply-settings` counterpart to `next.config.ts`'s marker.

## `cms-actions.ts`

A `"use server"` module: the write surface for content changes
(`saveDraft`, `discardDraft`, `publish`, `createPage`, `createTranslation`,
`deletePage`, `deleteTranslation`, `listMedia`, `deleteMedia`). Each handler
delegates to `makeActions(cmsConfig)`, which re-checks `authorize()` on every
call — a Server Action is a public POST endpoint, so the gate can't live in a
layout alone. No editor UI calls these yet; they're the surface for scripts,
a review/PR pipeline, or an agent-driven workflow.

## `app/media/upload/route.ts`

A Route Handler (not a Server Action — Next's default 1MB action-body cap is
the wrong shape for raw image bytes), forced to `runtime = "nodejs"` because
image processing (`sharp`) needs native bindings. Re-checks auth itself via
`handleMediaUpload`, since a Route Handler renders no parent layout.

## `slices/`

- **`registry.ts`** — slice name → React component map. The editor (once
  installed) reads only the keys, for its "add slice" menu.
- **`defaults.ts`** — starter props inserted when a slice is added.
- **`field-schema.ts`** — per-slice field hints (e.g. a `select` dropdown for
  an enum prop); anything without an entry auto-detects its control.
- **`slice-zone.tsx`** — renders an ordered `Slice[]` through the registry;
  this is what you import into a page.
- **`hero.tsx`**, **`prose.tsx`** — two example slices, meant to be replaced.

## `content/`

- **`home.md`** — the one seeded page, with a `slices` frontmatter array
  (`hero` + `prose`) that `SliceZone` renders.
- **`site.md`** — an empty frontmatter stub for site-wide settings content.

Both live flat under `content/` for the default locale; a non-default locale
would live under `content/<locale>/`. A draft of a page lives under
`content/.drafts/<slug>.md` until published (see
[Drafts and publishing](./drafts-and-publishing.md)).
