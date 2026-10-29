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

`@typren/studio` (the React UI that calls these actions) is not published yet.
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
`localAuth()` is a development-only stand-in, gated on `NODE_ENV` and a
loopback-bound dev server (`next dev -H 127.0.0.1`); swap in
`@typren/core/auth/next-auth`, `@typren/core/auth/clerk`, or your own
`AuthAdapter` before this reaches production.

See the [full reference](https://github.com/typren/typren/blob/develop/docs/site/reference-core.md)
for every export, option and subpath.

## License

[Functional Source License 1.1](./LICENSE), converting to Apache 2.0 two years
after each release. Free to use, modify and self-host for anything except a
competing hosted version of Typren. See
[the repository](https://github.com/typren/typren#license) for what that means
in practice.
