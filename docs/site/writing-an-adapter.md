---
title: Writing an adapter
description: How to implement a new ContentAdapter (or MediaAdapter) and conform it to the shared contract suite.
category: Contributing
order: 80
---

This page is for implementing a new `ContentAdapter` or `MediaAdapter` for Typren — a backend beyond the markdown, GitHub and Notion adapters this repo already ships. See [architecture](./architecture.md) for where adapters sit in the four-layer stack: `ContentAdapter` → `ContentStore` → `makeActions()` → studio UI.

## Shape of an adapter

An adapter is an interface plus a `create*Adapter(opts)` factory function — never a class, never a DI container. `createMarkdownAdapter`, `createGithubAdapter` and `createNotionAdapter` are the pattern to follow: each takes an options object and returns a plain object satisfying `ContentAdapter` (packages/core/src/types.ts).

Every I/O method on `ContentAdapter` is async and returns a `Promise`: `listSlugs`, `listLocales`, `exists`, `readRaw`, `writeRaw`, `deletePublished`, `readDraftRaw`, `writeDraftRaw`, `deleteDraft`, `hasDraft`. `parse`/`serialize` stay pure and synchronous — no I/O, since they only transform between an adapter-owned raw encoding (gray-matter markdown, a JSON envelope, whatever your backend's raw form is) and the structured `PageContent` shape. A `MediaAdapter` is smaller: `list()`, `upload(file)`, `delete(id)`, all async.

## Trust boundary is your job

Slug, locale and media-id validation happens **inside** the adapter, never in a caller. Never assume an upstream layer already checked — every public method is a potential entry point from a Server Action argument or an HTTP request, and the adapter is the only thing that actually knows how its own storage turns an id into a read or write.

Two real examples already in this repo:

**`createMarkdownAdapter`'s slug/locale guard** (packages/core/src/markdown-adapter.ts): a slug becomes a filesystem path, so it's checked against a plain allowlist before it ever touches `fs`:

```ts
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*$/i;
const safe = (slug: string) => {
  if (!SAFE_SLUG.test(slug)) throw new Error(`typren: unsafe slug "${slug}"`);
  return slug;
};
```

The locale is also a path segment, so it gets its own check — an allowlist against the configured `locales`, not a regex, since "valid-looking" isn't the same as "configured."

**`createGithubAdapter`'s `isAllowedRepoPath`** (packages/core/src/github-adapter.ts, exported): a second, independent trust boundary for an adapter whose writes resolve against a repo tree rather than a local directory. It rejects `..`, absolute paths, any dotfile/dot-dir path segment (which subsumes `.github/`), and well-known manifest filenames (`package.json`, `tsconfig.json`, lockfiles, …), then confirms the path resolves inside one of the adapter's configured `allowedRoots`. Per this repo's convention, the GitHub adapter owns this guard independently of (and in addition to) the slug allowlist every public method already applies — it does not inherit or reuse the filesystem adapter's guard just because both end up constraining a path string.

Write the equivalent guard for whatever your adapter's raw id actually is before it reaches a read or write call, and keep it inside the adapter.

If your adapter is an `AuthAdapter`, the same doctrine applies to `authorize()`: wrap identity resolution in try/catch and return `false` on any error. A thrown error must never default to allowed — fail closed, not open.

## A tier with no separate draft, if that's your backend's shape

An adapter whose backend has no API-level draft/publish distinction (Notion: a database row is just a row, there's no draft/published flag the API itself tracks) should make `writeDraftRaw` alias straight through to the same write `writeRaw` uses, and have `readDraftRaw`/`hasDraft` always report "no draft," and set `draftsWriteThrough: true` so `makeActions` authorizes a draft save as the publish it really is. This isn't a workaround to hide — it's a real, documented behavior difference (see notion-adapter.ts's own doc comment), and the contract suite has a seed option for exactly this case (see below). Don't fabricate a fake draft tier (a shadow property, a parallel row) just to fit the generic shape unless your backend actually gives you one worth using.

## Run the contract suite

Every real adapter in this repo (markdown, GitHub, Notion) runs [`@typren/contract-tests`](./reference-contract-tests.md)'s `createContentAdapterContractSuite` against itself, in addition to its own adapter-specific tests (`markdown-adapter.test.ts`, `github-adapter.test.ts`, `notion-adapter.test.ts`). A new adapter should too — it's the only thing proving a behavior like "an unsafe slug rejects the promise" or "listSlugs returns sorted" can't silently diverge between implementations.

```ts
import { describe } from "vitest";
import { createContentAdapterContractSuite } from "@typren/contract-tests";
import { createMyAdapter } from "./my-adapter";

describe("createMyAdapter contract", () => {
  createContentAdapterContractSuite(() => createMyAdapter({ /* ...opts */ }));
});
```

Pass `{ draftsWriteThrough: true }` as the suite's seed if your adapter has no separate draft tier (see above). `makeAdapter` is called once per `it()`, so an adapter backed by a fresh temp directory or a fresh fake client still works.
