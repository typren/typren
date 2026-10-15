---
title: Quickstart
description: Install Typren into a Next.js App Router project and publish your first page.
category: Start
order: 1
---

Typren adds a content layer to an existing Next.js App Router project: markdown
pages with frontmatter, rendered by your own React components. There is no
server to run and no account to create.

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
content layer: `cms.config.ts`, a `cms-actions.ts` write surface, a starter
`slices/` directory with two example components, a `content/` directory with
one page, and a `typren.config.json` with your admin route and locale
settings. It never overwrites a file that already exists; pass `--force` to
regenerate everything. See [Project anatomy](./project-anatomy.md) for what
each file does.

> **Security:** the scaffolded `cms.config.ts` wires up `localAuth()`, which
> only authorizes writes in `NODE_ENV === "development"` on a dev server
> bound to loopback (`next dev -H 127.0.0.1`). It fails closed in production
> until you swap in a real `AuthAdapter` — see [Auth model](./auth-model.md).

Add a `"@/*"` path alias to `tsconfig.json` if you don't already have one, as
`init`'s own output will remind you:

```json
{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }
```

(Use `["./src/*"]` instead if `init` detected a `src/` layout.)

## Render your first page

`init` seeds `content/home.md` with two slices (`hero` and `prose`). Read it
with the `cmsStore` the scaffold creates, and render its slices with the
generated `SliceZone`:

```tsx
// app/page.tsx
import { cmsStore } from "@/cms.config";
import { SliceZone } from "@/slices/slice-zone";

export default async function Home() {
  const page = await cmsStore.getPublished("home");
  return <SliceZone slices={page.slices} />;
}
```

Start your dev server (`npm run dev`) and the page renders from
`content/home.md`.

## Edit and publish

Typren's visual editor (`@typren/editor`) is still in progress and not yet
published to npm, so this scaffold wires up the content layer only — no
`/editor` route ships yet. Until it does, you have two ways to change content:

1. **Edit the markdown directly.** Change `content/home.md`'s frontmatter or
   slices and commit it. Since published content lives in your repo, every
   save is a commit with history and rollback for free.
2. **Use the generated server actions.** `cms-actions.ts` exports
   `saveDraft`, `publish`, `createPage` and friends — the same write surface
   an editor UI would call. Useful for scripts or an agent-driven workflow
   today:

   ```ts
   import { saveDraft, publish } from "@/cms-actions";

   const version = await saveDraft("home", {
     meta: { title: "Home" },
     slices: [{ slice: "hero", heading: "New headline", body: "..." }],
     body: "",
   });
   await publish("home");
   ```

See [Drafts and publishing](./drafts-and-publishing.md) for how draft/publish
and optimistic locking work underneath these calls.

## Next steps

- [Project anatomy](./project-anatomy.md) — what `init` wrote and why.
- [Architecture](./architecture.md) — the four layers content moves through.
- [Content tiers](./content-tiers.md) — swapping the filesystem adapter for
  live GitHub content.
- [Choosing auth](./choosing-auth.md) — replacing `localAuth()` before you
  deploy.

After upgrading any `@typren/*` package, run `npx typren migrate` and follow
it until it exits `0`.
