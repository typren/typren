---
title: Quickstart
description: Install Typren into a Next.js App Router project and publish your first page.
category: Start
order: 1
---

Typren adds a content layer to an existing Next.js App Router project: markdown
pages with frontmatter, rendered by your own React components, and edited in
a local studio that runs beside your site. There is no account to create.

## Requirements

- A Next.js project using the App Router (`app/` or `src/app/`).
- Node.js, with either npm or [Bun](https://bun.sh).

## Install

```bash
npm install @typren/core
npm install --save-dev typren
```

`typren` is the CLI (the package name on npm is `typren`, not `@typren/cli`).
`@typren/core` is the engine your scaffolded config imports.

## Scaffold

From the project root:

```bash
npx typren init
```

`init` detects your App Router base dir (`src/app` or `app`) and writes the
site side: `cms.config.ts`, a starter `slices/` directory with two example
components and the studio bridge, a `content/` directory with one page, and a
`typren.config.json` with your locale settings. It writes no studio, preview
or API route: the studio runs beside your site in `typren studio`. It also
binds your `package.json` `dev` script to loopback (`next dev -H 127.0.0.1`).
It never overwrites a file that already exists; pass `--force` to regenerate
everything. See [Project anatomy](./project-anatomy.md) for what each file
does.

Add a `"@/*"` path alias to `tsconfig.json` if you don't already have one, as
`init`'s own output will remind you:

```json
{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }
```

(Use `["./src/*"]` instead if `init` detected a `src/` layout.)

## Render your first page

`init` seeds `content/home.md` with two slices (`hero` and `prose`). Read it
with the scaffold's `getPage`, and render its slices with the generated
`SliceZone`:

```tsx
// app/page.tsx
import { getPage } from "@/cms.config";
import { SliceZone } from "@/slices/slice-zone";

export default async function Home() {
  const page = await getPage("home");
  return <SliceZone slices={page.slices} />;
}
```

`getPage` returns the published page, or its draft while the studio previews
your site.

Start your dev server (`npm run dev`) and the page renders from
`content/home.md`.

## Edit and publish

Install the studio and start it from the project root:

```bash
npm install --save-dev @typren/studio-local
npx typren studio
```

It opens the studio on `http://127.0.0.1:4400` and frames a preview copy of
your site that it starts itself, so your own `npm run dev` stays as it is.
Edits autosave as drafts; **Publish** writes the page into `content/`. Since
published content lives in your repo, every publish is a change you commit,
with history and rollback for free. To run your own dev server at the same
time, give the preview copy its own build directory; see
[Studio](./studio.md) for that and the rest of the setup.

> **Security:** the studio's writes go through `localAuth()`, which only
> allows them on a dev server bound to loopback. The studio is a local tool:
> never expose its port.

You can also edit the markdown directly: change `content/home.md`'s
frontmatter or slices and commit it.

See [Drafts and publishing](./drafts-and-publishing.md) for how draft/publish
and optimistic locking work underneath.

## Next steps

- [Project anatomy](./project-anatomy.md) — what `init` wrote and why.
- [Studio](./studio.md) — how the studio runs beside your site.
- [Architecture](./architecture.md) — the four layers content moves through.
- [Content tiers](./content-tiers.md) — swapping the filesystem adapter for
  live GitHub content.
- [Choosing auth](./choosing-auth.md) — replacing `localAuth()` before you
  deploy.

After upgrading any `@typren/*` package, run `npx typren migrate` and follow
it until it exits `0`.
