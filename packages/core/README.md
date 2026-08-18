# @typren/core

The engine behind [Typren](https://github.com/typren/typren): a markdown content
store, adapters, auth-gated actions, and an HTTP API, all plain TypeScript with
no UI. Read the root repo's README for what Typren is and why it exists; this
package is the part of it that runs on a server.

```
ContentAdapter    storage: fs + markdown, or your own KV/git/DB
      ↓
ContentStore      draft/publish, locale fallback, version-checked writes
      ↓
makeActions()     auth-gated handlers, called from your Server Actions
```

`@typren/editor` (the React UI that calls these actions) is not published yet.
This package is useful on its own if you're building your own admin UI, or
scripting content some other way.

## Install

```bash
npm install @typren/core
```

## Quick start

```ts
import { createMarkdownAdapter, makeActions } from "@typren/core";
import { localAuth } from "@typren/core/auth/local";

const adapter = createMarkdownAdapter({ contentDir: "./content", locales: ["en"] });

const actions = makeActions({
  adapter,
  auth: localAuth(), // dev-only by default; see @typren/core/auth/* for production
  registry: {},      // slice name -> component, owned by your app
  defaults: {},       // starter props inserted when a slice is added
  previewPath: "/editor/preview",
});

// In a Next.js Server Action, or anywhere else you can call an async function:
await actions.saveDraft("home", { meta: { title: "Hello" }, slices: [], body: "" });
```

`makeActions` is where the auth boundary lives: every handler it returns
calls `auth.authorize()` before touching the store. Wire it up to whatever
calls your Server Actions and it's the only place that needs an identity.
`localAuth()` is a development-only stand-in, gated on `NODE_ENV`; swap in
`@typren/core/auth/next-auth`, `@typren/core/auth/clerk`, or your own
`AuthAdapter` before this reaches production.

## Subpaths

| Import | What it's for |
|---|---|
| `@typren/core` | everything above: adapters, store, actions, sections |
| `@typren/core/i18n` | pure locale/routing helpers, no `node:fs`, safe in middleware |
| `@typren/core/proxy` | edge-safe locale rewrite, same constraint |
| `@typren/core/api` | a WHATWG `Request → Response` handler for the HTTP surface |
| `@typren/core/api/client` | a browser-safe fetch client for that API, no server imports |
| `@typren/core/seo` | metadata, sitemap, robots, JSON-LD, an `llms.txt` route (Next-only) |
| `@typren/core/auth/local` | the reference `AuthAdapter`: a static allowlist |
| `@typren/core/auth/next-auth` | `AuthAdapter` over an existing NextAuth session |
| `@typren/core/auth/clerk` | `AuthAdapter` over an existing Clerk session |
| `@typren/core/theme.css` | the `--typren-*` CSS variable contract editor UI reads |

`next`, `next-auth`, `@clerk/nextjs`, `react` and `react-dom` are all optional
peer dependencies. Install only the ones the adapters you actually use need.

## Adapters are interfaces, not requirements

`ContentAdapter`, `MediaAdapter` and `AuthAdapter` are plain interfaces built
by factory functions (`createMarkdownAdapter`, `createFsMediaAdapter`,
`localAuth`), not base classes. The shipped implementations are references,
not the only option: write your own for a different backend and it drops in
anywhere the interface is expected.

Trust boundaries belong to the adapter. `createMarkdownAdapter` validates
every slug and locale against an allowlist before it touches the filesystem,
`createFsMediaAdapter` does the same for media ids, and every `AuthAdapter`
fails closed on any error rather than defaulting to allowed. A new adapter for
a different backend needs to validate its own equivalent boundary; nothing
upstream checks it for you.

## License

[Functional Source License 1.1](./LICENSE), converting to Apache 2.0 two years
after each release. Free to use, modify and self-host for anything except a
competing hosted version of Typren. See
[the repository](https://github.com/typren/typren#license) for what that means
in practice.
