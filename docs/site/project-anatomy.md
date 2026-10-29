---
title: Project anatomy
description: Every file npx typren init writes, and what each one does.
category: Start
order: 2
---

`npx typren init` writes a fixed set of files relative to your project's
detected base dir (`src/` if you have `src/app`, otherwise the project root).
`typren.config.json` always lands at the project root regardless of that base
dir. It also edits one existing file: `package.json`'s `dev` script becomes
`next dev -H 127.0.0.1`, because in studio preview mode the dev server
renders drafts. If the script isn't a plain `next dev` (or has no
`package.json`), `init` leaves it alone and prints a warning instead.

`init` writes no studio, preview or API route and no write surface. Editing
happens in [`typren studio`](./studio.md), which runs beside the site and
writes the content directory itself.

## `typren.config.json` (project root)

```json
{
  "locales": ["en"],
  "defaultLocale": "en",
  "routing": "prefix-except-default",
  "onboarded": false
}
```

The bootstrap tier: which locales exist and the default locale's routing.
Read via `createFsSettingsAdapter({ file }).readBootstrap()`. Edit this by
hand, then run `npx typren apply-settings` to validate it and check that
`cms.config.ts` reads it. It also takes `typren studio`'s
`studio.previewCommand` (see [Studio](./studio.md#the-preview-command)).

## `cms.config.ts`

The one object that wires Typren into your project, plus the reads your
pages use:

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
  previewPath: "/",
  auth: localAuth(),
};

export const cmsStore = createStore(cmsConfig.adapter, { onPublish: cmsConfig.onPublish });

export const studioPreview = process.env.TYPREN_PREVIEW === "1" && process.env.NODE_ENV !== "production";

export async function getPage(slug: string, locale?: string) {
  return (studioPreview && (await cmsStore.getDraft(slug, locale))) || cmsStore.getPublished(slug, locale);
}
```

- **`adapter`** — a `createMarkdownAdapter` instance over `<baseDir>/content`
  (the fs + markdown `ContentAdapter`; see [Content tiers](./content-tiers.md)
  for the GitHub-backed alternative).
- **`auth: localAuth()`** — the site writes nothing, but `CmsConfig` needs a
  gate; `localAuth()` fails closed everywhere but a loopback-bound dev
  server. See [Auth model](./auth-model.md).
- **`getPage`** — what your pages call: the draft while `typren studio`
  previews the site (`TYPREN_PREVIEW=1`, never in a production build), the
  published page otherwise.

`cms.config.ts` carries a `typren:bootstrap-wired` marker comment that
`typren apply-settings` greps for.

## `site-style.tsx`

`SiteStyle` renders the Style tokens saved in `typren studio` as a `<style>`
in `<head>`, mapped onto your own CSS variables by `studio.style` in
`typren.config.json`. `SliceZone` renders it; see
"The site's style" in [Theming](./theming.md).

## `slices/`

- **`registry.ts`** — slice name → React component map.
- **`defaults.ts`** — starter props inserted when a slice is added. Its keys
  are the slices `typren studio` offers, and the CLI imports it directly, so
  keep it plain data. Importing it executes it: `typren studio` runs this
  file (and `field-schema.ts`) as code every time it starts.
- **`field-schema.ts`** — per-slice field hints (e.g. a `select` dropdown for
  an enum prop); anything without an entry auto-detects its control.
- **`slice-zone.tsx`** — renders an ordered `Slice[]` through the registry,
  with the saved Style; this is what you import into a page. In studio
  preview mode it also wraps each slice in a `data-typren-index` element and
  mounts the bridge.
- **`app/typren/section/page.tsx`** — one line that renders a single slice
  for the studio's section thumbnails (see the studio guide, which also
  covers the client canvas a static export needs). The bridge that
  connects the preview to the studio comes from `@typren/core/ui/studio-bridge`.
- **`hero.tsx`**, **`prose.tsx`** — two example slices, meant to be replaced.

## `content/`

- **`home.md`** — the one seeded page, with a `slices` frontmatter array
  (`hero` + `prose`) that `SliceZone` renders.
- **`site.md`** — a frontmatter stub for site-wide content. Add a `nav` list to
  edit the header menu in the studio (see [Navigation](./navigation.md)).

Both live flat under `content/` for the default locale; a non-default locale
would live under `content/<locale>/`. A draft of a page lives under
`content/.drafts/<slug>.md` until published (see
[Drafts and publishing](./drafts-and-publishing.md)).
