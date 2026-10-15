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
`slug` when there is one, and (for a hosted/multi-tenant setup) `siteId`/
`accountId`.

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
so it doesn't branch on `ctx.action`) only when `NODE_ENV === "development"`
**and** the request's `Host` is loopback (`localhost`, `127.0.0.1`, `[::1]`,
or a `*.localhost` name), and fails closed in production unless you pass
`allowInProduction: true` — which you should never do for a real deployment.
The loopback check exists because `NODE_ENV` alone doesn't stop a
misconfigured production host from running with `NODE_ENV=development`; the
scaffolded dev script binds Next to `127.0.0.1` (`next dev -H 127.0.0.1`) so
the dev server itself is never reachable off-box. See
[Choosing auth](./choosing-auth.md) for wiring a real provider before you
deploy.
