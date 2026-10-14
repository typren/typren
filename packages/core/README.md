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
| `@typren/core/auth/better-auth` | `AuthAdapter` over an existing Better Auth session |
| `@typren/core/auth/supabase` | `AuthAdapter` over an existing Supabase session |
| `@typren/core/auth/oidc` | `AuthAdapter` verifying a generic OIDC/JWT bearer token (Okta, Entra ID, Auth0, Keycloak, Google Workspace SSO), plus a `cfAccessAuthAdapter` preset for Cloudflare Access |
| `@typren/core/theme.css` | the `--typren-*` CSS variable contract editor UI reads |
| `@typren/core/github-webhook` | GitHub push-webhook handler, pairs with `createGithubAdapter` |

`next`, `next-auth`, `@clerk/nextjs`, `jose`, `react` and `react-dom` are all
optional peer dependencies. Install only the ones the adapters you actually
use need (`jose` backs `auth/oidc`'s JWT verification; Better Auth and
Supabase need no extra package, the host passes in an already-constructed
session getter or client).

## Live content from GitHub

`createGithubAdapter` (storage: GitHub, below) reads content straight from a
repo over the Contents API, no checkout, no build-time copy. That makes it a
viable **git runtime**: a server-rendered site can read its content live from
GitHub at request time, as long as two things are wired up so a page doesn't
re-fetch GitHub on every request and a publish is still fast to see:

1. **Cache the adapter's reads** with `readInit`, so your host framework's
   fetch cache (not this package) owns the caching:

   ```ts
   import { createGithubAdapter } from "@typren/core";

   // The SITE-RENDER instance: reads are cached and tagged.
   const siteAdapter = createGithubAdapter({
     owner: "acme",
     repo: "site",
     token: ghToken,
     readInit: () => ({ next: { tags: ["typren-content"] } }), // Next's fetch-cache tag
   });

   // The EDITOR's own instance: NEVER set readInit here. Draft reads must
   // always be fresh, a cached draft would show a stale version of exactly
   // the content someone is actively editing.
   const editorAdapter = createGithubAdapter({ owner: "acme", repo: "site", token: ghToken });
   ```

2. **Invalidate that cache from both directions**: a push to GitHub (someone
   edited content outside the CMS, or a redeploy landed) via the webhook
   handler below, and the editor's own publish, immediately, via
   `CmsConfig.onPublish` — without the second one, your own publish click
   would sit behind the push webhook's round trip before it's visible.

   ```ts
   // app/api/github-webhook/route.ts
   import { revalidateTag } from "next/cache";
   import { createGithubWebhookHandler } from "@typren/core/github-webhook";

   const { POST } = { POST: createGithubWebhookHandler({
     secret: process.env.GITHUB_WEBHOOK_SECRET!,
     branch: "main",
     onChange: async () => revalidateTag("typren-content"),
   }) };
   export { POST };
   ```

   ```ts
   // cms.config.ts
   export const cmsConfig: CmsConfig = {
     // ...
     adapter: editorAdapter,
     onPublish: async () => revalidateTag("typren-content"), // same tag, same cache
   };
   ```

Configure the webhook in GitHub's repo settings (content type
`application/json`, the same secret, `push` events). A draft-only push never
calls `onChange` (there is nothing cached to invalidate: draft reads are
never cached, see `readInit`'s doc comment). A force push, or a push whose
payload has no commit list, calls `onChange` with `full: true` and empty
`paths`: a host doing per-slug invalidation must then invalidate everything.
The single-tag example above already does. Listing a page directory still
goes through the Contents API's directory-listing endpoint, which caps at
1000 entries; `createGithubAdapter`'s `listSlugs` has a `ponytail:` comment
naming the Git Trees API (`/git/trees/<branch>?recursive=1`) as the upgrade
path for a site with more pages than that.

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
