---
title: Auth model
description: AuthAdapter, fail-closed authorization, and the allowlist rules each mapping enforces.
category: Concepts
order: 13
---

Auth is pluggable the same way storage is (see [Architecture](./architecture.md)):
an `AuthAdapter` interface, plus one factory per identity provider, from
`@typren/core`'s `auth/*` subpath exports.

## The interface

```ts
interface AuthAdapter {
  getUser?(ctx: AuthContext): Promise<AuthUser | null>;
  authorize(ctx: AuthContext): Promise<boolean>;
}
```

`AuthContext` carries the `action` being attempted (`"read"`, `"saveDraft"`,
`"discardDraft"`, `"publish"`, `"createPage"`, `"renamePage"`,
`"deletePage"`, `"uploadMedia"`, `"deleteMedia"`, or `"admin"`), the target
`slug` and `collectionId` when there are any, the `locale` the request
resolved, and (for a hosted/multi-tenant setup) `siteId`/`accountId`. Reads
(`api/routes.ts`) and every write (`makeActions`, which the routes and
collection actions share) pass all of these, so a policy can grant or deny
per slug, per collection, or per locale:

- A collection write carries the section's `collectionId`.
- A write carries the `locale` it targets; `createTranslation` carries the
  new `toLocale`, and `deleteTranslation` the locale being deleted.
  `deletePage` and `renamePage` act on every locale, so they pass none.
- A settings write's `"admin"` check carries the locale being written, the
  same locale its follow-up content check sees. Bootstrap writes and media
  upload/delete are site-wide, so they pass no slug, collection or locale.
- `createPage` carries the slug derived from the title. `renamePage` is
  authorized twice, once for the source slug and once for the destination,
  and `duplicatePage` the same way (as `"createPage"`), with the derived
  copy slug checked before anything is written. A policy that reserves a
  slug can't be bypassed by renaming or duplicating onto it.

**`"saveDraft"` is not always a lesser tier than `"publish"`.** An adapter
with no separate draft storage (the Notion adapter) writes a draft straight
to the live row, so it sets `draftsWriteThrough: true` and `makeActions`
authorizes its draft writes (`saveDraft`, `createTranslation`) as
`"publish"`. A role granted only `"saveDraft"` can't change Notion-backed
content at all.

**`authorize()` must fail closed.** Every adapter shipped in `@typren/core`
wraps its identity resolution in a try/catch and returns `false` on any
error — a thrown error never defaults to allowed. `resolveAuth(config)` is
the single resolution point both the action guard (`makeActions`) and a
layout gate use, so they can never diverge, and it throws at construction
time if a `CmsConfig` sets neither `auth` nor the deprecated `authorize()`.

## "admin" is a separate tier

`"admin"` covers settings/onboarding/bootstrap writes — actions that
reparameterize what the *next* boot trusts. Every mapping below gates it
independently of ordinary content actions: it requires `adminRoles` to be
set and the user's roles to intersect it, full stop. A mapping with no
`adminRoles` configured **denies** admin actions rather than falling back to
`allowedRoles`. A host has to opt in, explicitly, to who may reconfigure the
site.

## The allowlist rule, and which mappings enforce it at construction

With neither `allowedEmails` nor `allowedRoles` set, a mapping would
authorize *any* resolved identity — almost never the right policy for a
public editor. Every mapping throws at construction if you pass none of
these:

- **`nextAuthAdapter`** (`@typren/core/auth/next-auth`)
- **`clerkAuthAdapter`** (`@typren/core/auth/clerk`) — also accepts
  `allowedUserIds` as a third way to satisfy the requirement
- **`betterAuthAdapter`** (`@typren/core/auth/better-auth`)
- **`supabaseAuthAdapter`** (`@typren/core/auth/supabase`)
- **`oidcAuthAdapter`** (`@typren/core/auth/oidc`) — generic OIDC/JWT for
  Okta, Entra ID, Auth0, Keycloak, Google Workspace SSO

`cfAccessAuthAdapter` (also from `@typren/core/auth/oidc`) is the one
exception: Cloudflare Access already gated the request against its own
per-application policy before issuing the token, so a verified Access token
is already allowlisted by Access itself, and `allowedEmails`/`allowedRoles`
are optional extra narrowing inside Typren.

## The verified-email rule

An allowlisted email only matches when the identity provider itself vouches
for it, not merely a claim the user's own profile asserts:

- **OIDC/JWT** (`oidcAuthAdapter`, `cfAccessAuthAdapter`): the email claim is
  only read when the token carries `email_verified: true` (or, for
  Cloudflare Access, is inherently trusted — Access only issues a token after
  the user proved control of it).
- **Clerk** (`clerkAuthAdapter`): only the user's primary email, and only
  when `primaryEmailAddress?.verification?.status === "verified"`.
- **Better Auth** (`betterAuthAdapter`): only when `session.user.emailVerified`
  is true.
- **NextAuth** (`nextAuthAdapter`): only when the host's required
  `isEmailVerified(session)` callback returns true; NextAuth's session has
  no verified flag of its own.
- **Supabase** (`supabaseAuthAdapter`): only when
  `user.email_confirmed_at` is set.
- **Cloudflare Access** (`cfAccessAuthAdapter`): trusts Access's email
  outright, as above.

If your IdP never sends a verified-email signal (Entra ID, notably, does not
reliably send `email_verified`), use `allowedRoles` instead of
`allowedEmails` — an unverified email can never satisfy the allowlist, by
design, for any mapping.

## Roles, and where they come from

Each mapping reads roles from wherever its provider can't be spoofed by the
signed-in user themselves:

- **Supabase**: only `user.app_metadata` (`roles` array or singular `role`),
  never `user_metadata` — a Supabase user can write their own
  `user_metadata` from the client, so trusting it would let anyone grant
  themselves roles. `app_metadata` is writable only via the service-role key.
- **Better Auth**: `session.user.role`, split on commas by default
  (the admin plugin stores multi-role users as a comma-separated string);
  override with `rolesFrom`.
- **Clerk**: the active org role session claim (v1 `org_role`, v2 `o.rol`
  normalized to the `"org:admin"` form), and only while the active org id
  (v1 `org_id`, v2 `o.id`) equals the required `organizationId` option. Any
  signed-up user can create an org and be its `org:admin`, so a role from
  any other org never counts. Clerk's `"admin"` action also has to pass the
  ordinary allowlist (`allowedUserIds`/`allowedEmails`/`allowedRoles`)
  before `adminRoles` is checked.
- **Generic OIDC**: a configurable claim (default `"roles"`), normalized from
  either a string or a string array.
- **Cloudflare Access**: the `groups` claim — present only when the Access
  team has SCIM group sync configured. Without it, every token omits
  `groups`, so `allowedRoles`/`adminRoles` silently deny everyone rather than
  signal misconfiguration; confirm SCIM sync before relying on role gating
  with this preset.

## Composing identity and policy: `withPolicy`/`filePolicy`

`withPolicy(identity, policy)` composes an identity adapter ("who is this?")
with a separate `Policy` ("what may they do?") into one `AuthAdapter`. The
identity adapter's own `authorize()` (if it has one) is never consulted —
the policy is authoritative, so adding a group policy can't be silently
bypassed by swapping identity adapters. It fails closed the same way: no
`getUser`, no resolved user, or any error on either side denies.

`filePolicy({ file })` is the first `Policy` implementation: reads a
`.typren/access.yml`-shaped file (`groups` mapping a group name to its
allowed actions, `members` mapping an email — or a `*@domain` wildcard
default — to a group) fresh on every call, and denies by default when the
user has no matching member entry or the group lists no entry for the
requested action. Keep this file's path outside anything your
`ContentAdapter` can write — see [Security model](./security-model.md) for
why.

## `localAuth()` for development

`@typren/core/auth/local`'s `localAuth()` is what `typren init` scaffolds.
It authorizes every action identically (there's only one tier in local dev,
so it doesn't branch on `ctx.action`) only when all three hold:

- `NODE_ENV === "development"` (it fails closed in production unless you pass
  `allowInProduction: true`, which you should never do for a real
  deployment);
- the Next server is **bound to loopback**: started with
  `next dev -H 127.0.0.1`, which `typren init` writes into
  your `dev` script. The default `next dev` listens on
  every interface, and `-H localhost` is indistinguishable from it at
  runtime, so both are refused. `-H ::1` is refused too: Next reports it the
  same way as `-H ::`, which listens on every interface;
- the request's `Host` is loopback (`localhost`, `127.0.0.1`, `[::1]`, or a
  `*.localhost` name);
- the request doesn't look forwarded: no non-loopback hop in
  `X-Forwarded-For`, no non-loopback `X-Forwarded-Host`, and no `Forwarded` or
  `X-Real-IP` header. (Next fills `X-Forwarded-*` itself on every request, with
  loopback values for a direct browser, so only the values count.)

The bind is the actual network boundary. A route handler or server action
never sees the client's socket address, and the `Host` header is whatever the
client sends, so a LAN client could spoof `Host: localhost` against a server
listening on all interfaces. A loopback bind makes the server unreachable
off-box; the `Host` check stays only as an extra filter against DNS
rebinding. `localAuth()` reads the bind from Next's own startup state, so a
`NODE_ENV=development` server bound to a public interface is refused too. See
[Choosing auth](./choosing-auth.md) for wiring a real provider before you
deploy.

**Never put `localAuth()` behind a reverse proxy, tunnel or port forwarder.**
Anything on the same machine that rewrites `Host` to the upstream (nginx's
default `proxy_set_header Host $proxy_host`, a VS Code or Codespaces public
forwarded port, `ngrok --host-header=rewrite`) reaches the loopback-bound
server from the internet and passes the bind and `Host` checks. The
forwarding-header refusal catches forwarders that announce themselves, but one
that strips those headers defeats it, so treat it as a tripwire, not a
boundary. If you need to share a dev server, wire a real `AuthAdapter`.

### Astro and other non-Next hosts

`localAuth()`'s defaults read Next's startup state and Next's `headers()`, so
on any other host they deny every request. Supply both facts yourself:

- `isBoundToLoopback`: return `true` only from the address your server
  **actually bound**, never from config you hope was applied and never from
  the request;
- `getHost`: return the request's `Host` header. It stays a deny-only filter;
- `hasForwardedHeaders`: return `true` when the request looks forwarded;
  `isForwardedRequest(request.headers)`, exported from the same entry, applies
  the check above.

Astro hands integrations the dev server's real bound address in its
`astro:server:start` hook. Record it in `astro.config.mjs`:

```js
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  integrations: [
    {
      name: "typren-loopback-bind",
      hooks: {
        // `address` is the dev server socket's own AddressInfo.
        "astro:server:start": ({ address }) => {
          globalThis.__typrenBoundToLoopback = address.address === "127.0.0.1";
        },
      },
    },
  ],
});
```

Start the dev server on loopback (`package.json`):

```json
{ "scripts": { "dev": "astro dev --host 127.0.0.1" } }
```

Then build the config per request, so `getHost` reads that request's `Host`:

```ts
// src/pages/api/typren/[...path].ts
import type { APIRoute } from "astro";
import { createTyprenApi } from "@typren/core/api";
import { isForwardedRequest, localAuth } from "@typren/core/auth/local";
import { cmsConfig } from "../../../cms.config";

export const prerender = false;

const { handler } = createTyprenApi(
  (request) => ({
    ...cmsConfig,
    auth: localAuth({
      isBoundToLoopback: () => globalThis.__typrenBoundToLoopback === true,
      getHost: async () => request.headers.get("host"),
      hasForwardedHeaders: async () => isForwardedRequest(request.headers),
    }),
  }),
  { basePath: "/api/typren" }
);

export const ALL: APIRoute = ({ request }) => handler(request);
```

`astro build`, `astro preview` and a production server never run
`astro:server:start`, so the flag stays unset and every request is denied, as
it is under `NODE_ENV=production`. An all-interfaces bind (`astro dev --host`)
records `false`. Only a literal `true` passes; any other value, and any throw
from a check, denies. The flag lives on `globalThis`, so it reaches your route
only when Astro runs SSR in the dev server's own Node process (the default). A
dev runtime that runs routes elsewhere, such as workerd, never sees it and
denies.
