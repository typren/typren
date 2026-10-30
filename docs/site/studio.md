---
title: Studio
description: Edit content in typren studio, which runs beside your site the way Storybook runs beside a component library.
category: Start
order: 3
---

The studio runs beside your site. `npx typren studio`, run from your site's
root, opens the studio UI in your browser from the cloud and runs two things
on your machine, stopping both when you press Ctrl-C:

- **The content API** on `http://127.0.0.1:4400`, served by the CLI process
  itself. It reads and writes your content directory directly.
- **A preview copy of your site**: your own dev command, started with
  `TYPREN_PREVIEW=1` on the next port (`4401`). The studio frames its real
  pages, so your routing, layout and styles apply as they are.

Your site mounts no studio, preview or API routes, and your usual
`npm run dev` on its usual port is never framed or touched. Both can run at
once.

```bash
npx typren studio          # the studio UI from the cloud (default)
npx typren studio --local  # the studio UI on this machine
```

| Flag | Default | |
|---|---|---|
| `--local` | off | Run the studio UI on this machine (see [Local studio](#local-studio)). |
| `--cloud-url <url>` | `https://app.typren.com`, or `TYPREN_CLOUD_URL` | The cloud studio's origin. https, or http on loopback. |
| `--port <n>` | `4400` | The API's port (the studio's, with `--local`). |
| `--preview-port <n>` | API port + 1 | The preview copy's port. |
| `--site-url <url>` | none | Frame a site that is already running at this URL instead of starting one. |

## Connected studio

By default the studio's interface comes from the cloud, so your machine
runs only your site's preview and a small API, not a second app with its own
build. `typren studio` mints a random pairing token for the session, then
opens and prints a link like:

```
https://app.typren.com/connect#port=4400&token=…
```

The page reads the port and token from the link's `#fragment`, which your
browser never sends to the cloud's server, then removes them from the address
bar. From then on your browser calls `http://127.0.0.1:4400/api/typren`
directly, and frames the preview copy directly.

**What leaves your machine:** nothing but your browser's own requests for
the studio's UI. Content, drafts, media and settings travel only between your
browser and `127.0.0.1`. No relay, no account, no sign-in.

**Security model:**

- The API binds to `127.0.0.1` and answers one origin, the cloud's, and only
  with `Authorization: Bearer <token>`, compared in constant time. A request
  from any other origin, or with no `Origin` header at all, is refused before
  it reaches your content. Its CORS answer names that exact origin, never
  `*`, and uses no cookies.
- The token exists only in the running process and in the link. Press Ctrl-C
  and it is gone; the next run mints a new one. Treat the link like a
  password while the studio runs.
- The preview copy's bridge and canvas answer only the cloud origin
  (`TYPREN_STUDIO_ORIGIN` is set to it), and still check the studio's nonce.
- Chrome may ask to let the page reach devices on your local network: that
  is the page asking to call `127.0.0.1`, which is the point. Refuse it and
  the studio says it can't reach your machine.

If the page says it can't reach the local studio, check that
`typren studio` is still running. If it says the link was rejected, the
studio was restarted: use the new link it printed.

With `--site-url`, start your site with `TYPREN_STUDIO_ORIGIN` set to the
cloud origin (`https://app.typren.com`) as well as `TYPREN_PREVIEW=1`.

## Local studio

`typren studio --local` runs the studio UI on your machine instead: a Next.js
app on `http://127.0.0.1:4400` with its own content API and auth, and no
token or cross-origin access. It needs `@typren/studio-local` installed in the
site (`npm install --save-dev @typren/studio-local`).

> **Security:** both servers bind to `127.0.0.1`. The local studio's writes
> go through `localAuth()`, which only allows them on a loopback-bound dev
> server, so the studio is a local tool: never expose either port.

## Saving and pushing

When your site is a git checkout, the studio's edit lifecycle follows git:

| Action | What happens |
|---|---|
| Autosave | There is no Save button. About a second after you stop typing, the page's draft is written to `.drafts/<slug>.md` in the content directory, and the edit bar says **Saving…**, then **Saved just now** or **Saved 2 min. ago**. The preview copy shows the draft. Nothing touches git. Leaving the page, switching locale or opening Review saves what is left first; when that save fails, the studio asks before dropping it. |
| **Version history** | Hover or focus the save status to see the page's commits, newest first, with subject, author, time and short hash, under an **Unpushed draft** row while the page has one. It is read-only. From a terminal: `typren changes log <page>`. |
| **Templates** | Saving a section (the heart, or Save changes in Website → Templates → Sections) or a page template (Website → Templates → Pages), or deleting one, rewrites `.typren/library.md` and commits it alone as `content: save section <name>`, `content: update page template <name>` and so on. |
| **Navigation, Settings and Style** | Autosave the same way, with the same status and history. The menu's draft is the site doc's (`.drafts/site.md`); Settings and Style share the settings doc's (`.typren/.drafts/settings.md`), since Style's tokens live in that doc. Leaving Navigation saves what is left first. |
| **Review** | Off, with the reason on hover, until something is saved. Lists every draft (each page, **Navigation**, **Site settings**), and every saved file your branch's upstream doesn't have yet (media and so on), with its path, whether it was added, modified or deleted, and the commits that touched it. Tick the ones you want, or Select all, then **Push selected** or **Discard selected**; each row also pushes or discards on its own. |

Pushing sends one commit per draft, made from it at push time:
`content: update <slug>` for a page, `content: update navigation` for the
menu, `content: update settings` for Settings and Style together. The rest
waits. Files committed earlier keep
their own commits, messages and authors, nothing is squashed. Discarding a
page drops its draft; discarding a file puts it back to the version already
pushed as a new commit, so your history keeps both. The same works from a
terminal with `typren changes list|push|discard|log`.

Push uses your own git credentials and never forces. A branch with no
upstream has nowhere to push, so run `git push -u origin <branch>` once from
a terminal first.

When git can't save or push, the studio says why in plain words:

| Cause | What the studio says |
|---|---|
| No branch checked out (a detached HEAD) | Check out a branch in your site folder to save. Review stays off until you do, and your draft is kept. |
| Git has no name or email for you | Set your name and email in git (`git config user.name` and `user.email`). |
| A pre-commit hook failed | A check in your repository stopped the commit, with the hook's first line. |
| Push credentials failed | Git couldn't sign in to your remote. Check that you can push from a terminal. |
| Someone pushed first | Pull their changes, then push again. |
| Your branch is behind its upstream | Pull the latest changes, then try again. |

Anything else shows git's first line. A failed commit leaves your files and
git's staging area as they were before the push, rename, delete or upload,
and your draft is kept, so push again once the cause is fixed.

Keep `.drafts/` out of git by adding it to `.gitignore`. The studio never
stages it, but a `git add .` of your own would.

Outside a git checkout, autosave writes the draft and Publish makes it the
live content, with no commits. Discard drops the draft.

## What the studio reads

The studio does not import your `cms.config.ts`: that file pulls in your
React components through your own path aliases and bundler. It reads the data
it needs instead, from the layout `typren init` writes:

| What | Where |
|---|---|
| Content | `studio.contentDir`, else whichever of `src/content` or `content` exists. |
| Slice list and starter props | `slices/defaults.ts` beside the content dir, or in `studio.slicesDir`. Its keys are the slices the studio can add. |
| Field hints | `field-schema.ts` in the same folder (optional). |
| Locales | `typren.config.json`. |
| Media | `studio.media`, else uploads go to `public/img` and are served at `/img/*`. |

The CLI imports the two slice files with Node's built-in TypeScript support,
so keep them plain data: type-only imports, no path aliases, no props or JSX.
A slice missing from `defaults.ts` is missing from the studio's add menu.

Importing them runs them: every time the studio starts, the code in
`defaults.ts` and `field-schema.ts` executes with your user's permissions,
even with `--site-url`, where no preview server is started. Treat these files
like `package.json` scripts, and open the studio only on a checkout you trust.

## The studio block

A site whose layout differs from the scaffold's tells the studio so in the
`studio` block of `typren.config.json`. Every key is optional and defaults to
the scaffold's convention. The CLI validates the block when it starts and
stops with a message naming the key that is wrong.

```json
{
  "studio": {
    "contentDir": "content",
    "slicesDir": "lib/slices",
    "media": { "dir": "public/uploads", "publicPath": "/uploads" },
    "previewPath": "/draft",
    "homeSlug": "index",
    "sectionRoute": false
  }
}
```

| Key | Default | Meaning |
|---|---|---|
| `contentDir` | `src/content` or `content`, whichever exists | Markdown content directory, inside the site root (relative, no `..`). |
| `slicesDir` | `slices/` beside the content dir | Folder holding `defaults.ts` (and optionally `field-schema.ts`), inside the site root (relative, no `..`). |
| `sections` | the studio's Website rail | The studio's rail entries, the same shape as `CmsConfig.sections`. Custom entries need `element` or `host: true`. |
| `media` | `{ "dir": "public/img", "publicPath": "/img" }` | Where uploads are stored (inside the site root, no `..`) and the URL path they are served at (starts with `/`). |
| `previewPath` | `/` | Route prefix the page preview frames, so `"/draft"` frames `/draft/about`. Point it at a route that renders drafts. |
| `homeSlug` | `home` | The page served at `/`. |
| `nestedLayouts` | none | Page paths (`/` plus the slug), by prefix, whose route adds a layout or page-level markup of its own, e.g. `["/blog"]`; `"/"` lists the home page alone. The page canvas renders slices under the root layout only, so these pages edit on their real route instead (see [The page canvas](#the-page-canvas)). |
| `sectionRoute` | `/typren/section` | Path of the one-slice route (see [Render one section](#4-render-one-section-optional)), or `false` when the site has none: Templates then shows schematic cards at once instead of probing for 20 seconds. |
| `previewCommand` | the site's `dev` script | See [The preview command](#the-preview-command). |

The Settings panel shows its Advanced bootstrap fields only when the site
already has a `typren.config.json`.

## The preview command

By default the preview copy is your `dev` script, run through the package
manager your lockfile names, with Next.js's port flags appended. With npm
that is:

```bash
TYPREN_PREVIEW=1 npm run dev -- -p 4401 -H 127.0.0.1
```

For another framework, set `studio.previewCommand` in `typren.config.json`.
`{port}` is replaced with the preview port:

```json
{
  "studio": { "previewCommand": "npm run dev -- --port {port} --host 127.0.0.1" }
}
```

The command is split on whitespace, so it can't contain quoted arguments.
The preview copy also gets `PORT` and `TYPREN_STUDIO_ORIGIN` (the studio UI's
origin: the cloud's, or `http://127.0.0.1:4400` with `--local`) in its
environment. If it exits, the studio stops and prints its
output.

## Site integration

`typren init` scaffolds all of this. For an existing Next.js site, the site
needs three dev-only hooks, all keyed on `TYPREN_PREVIEW=1`. None of them are
active in a production build.

### 1. Render drafts in preview mode

The studio writes drafts as you edit. The preview copy renders a page's draft when it
has one, and the published page otherwise:

```ts
// cms.config.ts
export const studioPreview =
  process.env.TYPREN_PREVIEW === "1" && process.env.NODE_ENV !== "production";

export async function getPage(slug: string, locale?: string) {
  return (studioPreview && (await cmsStore.getDraft(slug, locale))) || cmsStore.getPublished(slug, locale);
}
```

```tsx
// app/[[...slug]]/page.tsx
import { getPage } from "@/cms.config";
import { SliceZone } from "@/slices/slice-zone";

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const page = await getPage((await params).slug?.join("/") ?? "home");
  return <SliceZone slices={page.slices} />;
}
```

An environment flag, not a draft cookie, because a statically exported site
has no request to read a cookie from.

### 2. Load the bridge and mark slices

The bridge lets the studio select a block when you click it in the preview.
It talks only to the studio's origin:

```tsx
// slices/studio-bridge.tsx
"use client";

import { useEffect } from "react";
import { initPreviewBridge } from "@typren/core/ui/preview-bridge.vanilla";

export function StudioBridge({ origin }: Readonly<{ origin?: string }>) {
  useEffect(() => (origin ? initPreviewBridge(origin) : undefined), [origin]);
  return null;
}
```

`SliceZone` wraps each slice in a `data-typren-index` element and mounts the
bridge, in preview mode only:

```tsx
// slices/slice-zone.tsx
export function SliceZone({ slices }: Readonly<{ slices: Slice[] }>) {
  const rendered = slices.map((s, i) => {
    const Component = registry[s.slice];
    if (!Component) return null;
    return studioPreview ? (
      <div key={i} data-typren-index={i}>
        <Component {...s} />
      </div>
    ) : (
      <Component key={i} {...s} />
    );
  });
  if (!studioPreview) return rendered;
  return (
    <>
      {rendered}
      <StudioBridge origin={process.env.TYPREN_STUDIO_ORIGIN} />
    </>
  );
}
```

Render one `SliceZone` per page: each one mounts its own bridge.

> **Security:** the bridge's origin comes from `TYPREN_STUDIO_ORIGIN`, which
> `typren studio` sets on the preview copy, never from the page URL or an
> incoming message. Any other page that frames the preview gets no messages
> from it and cannot send it any. Without the variable the bridge stays off,
> so with `--site-url`, start your site with `TYPREN_STUDIO_ORIGIN` set to
> the studio UI's origin, exactly as your browser shows it
> (`https://app.typren.com`, or `http://127.0.0.1:4400` with `--local`), as
> well as `TYPREN_PREVIEW=1`.

### 3. Give the preview copy its own build directory

`next dev` refuses to start a second server on a project whose `.next`
directory another dev server holds. To run your own dev server and the
studio at once, point the preview copy at another directory:

```ts
// next.config.ts
const nextConfig: NextConfig = {
  distDir: process.env.TYPREN_PREVIEW === "1" ? ".next-preview" : ".next",
};
```

Add `.next-preview/` to `.gitignore`.

### 4. Render one section (optional)

Website → Templates shows each saved section, slice type and page template
as your site renders it. It frames `/typren/section?slice=<json>` on the preview copy, a
route that renders one slice from the props in the query. The studio checks
once per session whether the route answers; without it, Templates shows
schematic cards instead.

The Sections gallery loads the same route once for the whole grid, as
`/typren/section?slices=<json>`: one transparent frame lies over the grid and
draws every tile, each section rendered 1280px wide and scaled into its tile,
so a folder costs one page load rather than one per tile. Both forms below
support it with no extra code. The full viewer still frames one slice.

```tsx
// app/typren/section/page.tsx
import { createSectionCanvas } from "@typren/core/ui/section-canvas";
import { cmsConfig } from "@/cms.config";

export default createSectionCanvas(cmsConfig.registry);
```

`typren init` scaffolds this file. It renders only while the studio previews
(`TYPREN_PREVIEW=1`, never in a production build) and otherwise returns an
empty page. The query is validated against your registry before it becomes
props, and raw-HTML keys (`__html`, `dangerouslySetInnerHTML`) and
`javascript:`, `vbscript:` or `data:` URLs under link-like keys are dropped.
Anyone can link to this route while the preview runs, so treat every other
prop it passes as untrusted: a slice that renders a string prop as HTML
renders whatever the link carries. Your root layout still wraps the page; hide any header or footer for
this route there if you want chrome-free thumbnails.

This form renders the slice on the server, so it reads `searchParams`. A
static export (`output: "export"`) refuses that even under `next dev`, so on
an exported site render the slice in the browser instead: build a client
canvas in a `"use client"` file and pass it in place of the registry.

```tsx
// app/typren/section/canvas.tsx
"use client";
import { createClientSectionCanvas } from "@typren/core/ui/section-canvas-client";
import { registry } from "@/slices/registry";

export default createClientSectionCanvas(registry);
```

```tsx
// app/typren/section/page.tsx
import { createSectionCanvas } from "@typren/core/ui/section-canvas";
import Canvas from "./canvas";

export default createSectionCanvas(Canvas);
```

The gate stays on the server, and the page never reads the query, so it
exports as a static page. The client canvas renders nothing unless the server
form hands it the studio's origin, so mounting it on its own opens nothing. The catch is that every slice in that registry must
render on the client: an `async` server component, or one that imports
server-only code, cannot. If your registry has those, keep the server form
and turn export off for the preview copy only
(`output: process.env.TYPREN_PREVIEW === "1" ? undefined : "export"`).

The two forms differ in how the grid gets its slices. The server form
renders every slice the grid's URL carries, so any component works, async
and server-only ones included; when you open another folder or a section
changes, the studio reloads the frame with the new list. The URL carries
the whole folder, so a folder of very large saved sections can pass the dev
server's URL limit (Node's default is 16KB of headers), and those tiles stay
schematic cards. The client form renders the slices the studio posts to the
frame, checked the same way as the query, so it never reloads and has no
URL limit, but every slice must render on the client.

#### The page canvas

With the client form, the same route is also the studio's page canvas
(`/typren/section?page`). The studio loads it once per session beside the
page preview and, in edit mode, shows it instead: page switches, prop edits,
inline edits, locale switches and adding, removing or reordering sections
are posted to it and render in place, with no reload. Each section renders
under your root layout, in order, inside its own error boundary, so one that
throws leaves the rest standing. Posted slices pass the same checks as the
query, plus caps on count, depth and size, and the studio signs every
message with a per-session nonce from the frame URL's fragment.

The canvas renders slices under the root layout only. A page whose route adds
a layout or markup of its own (a blog post wrapper, say, or a home page that
wraps its first sections in a shared hero band and passes them extra props)
would look different there, so list those routes in the `studio` block's `nestedLayouts`; they edit on their
real route, which reloads after each save as before. Browse mode always shows
the real route. The server form has no client renderer, so it tells the
studio at once and editing stays on the real route; so does a site on an
older core, after a three-second wait for the canvas to answer.

In the grid frame your layout still wraps the tiles (its fonts and CSS
variables apply), but everything outside them is hidden and the page is
transparent. Sections render in a frame as tall as the grid, so a section
sized in viewport-height units (`min-h-screen`, `100svh`) renders taller
there than on a desktop screen, and its tile shows its top 800px.
