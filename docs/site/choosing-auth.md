---
title: Choosing an auth adapter
description: Pick and wire an AuthAdapter for local dev, an existing identity provider, or a generic OIDC/JWT issuer.
category: Guides
order: 24
---

Every write Typren's `makeActions()` exposes calls `auth.authorize()` first.
An `AuthAdapter` is a plain object with `getUser()` and `authorize(ctx)`; pick
the subpath that matches how your project already authenticates, construct
it, and pass it as `auth` to `makeActions`/`CmsConfig`.

## Decision table

| Your project already has | Use | Allowlist required to construct? |
|---|---|---|
| Nothing yet, just developing locally | `@typren/core/auth/local` | No — dev-only, gated on `NODE_ENV` |
| NextAuth v5 | `@typren/core/auth/next-auth` | No, but default-open without one |
| Clerk | `@typren/core/auth/clerk` | No, but default-open without one |
| Better Auth | `@typren/core/auth/better-auth` | **Yes — throws without one** |
| Supabase Auth | `@typren/core/auth/supabase` | **Yes — throws without one** |
| A generic OIDC/JWT issuer (Okta, Entra ID, Auth0, Keycloak, Google Workspace SSO) | `@typren/core/auth/oidc` | **Yes — throws without one** |
| Cloudflare Access | `@typren/core/auth/oidc`'s `cfAccessAuthAdapter` | No — Access's own per-application policy already allowlists the request |

"Allowlist" means `allowedEmails` and/or `allowedRoles`. `next-auth` and
`clerk` stay default-open for back-compat with existing configs; every other
mapping added since (`better-auth`, `supabase`, `oidc`) throws at construction
if you pass neither, because a signed-in session with no allowlist would
authorize anyone who can sign in — almost never the intended policy for a
public editor.

## The verified-email rule

Every mapping that can satisfy `allowedEmails` only lets a **provider-verified**
email match it:

- `next-auth` and `clerk`: no verification signal is checked (the session
  shape doesn't carry one), so `allowedEmails` there just matches whatever
  email the session carries.
- `better-auth`: only when `session.user.emailVerified === true`.
- `supabase`: only when `user.email_confirmed_at` is set.
- `oidc`: only when the token's `email_verified` claim is `true` (or, for
  `cfAccessAuthAdapter`, always — Access only issues a token after the user
  proved control of the email, so there is no separate claim to check).

In every case this happens by omitting the email from the resolved
`AuthUser` entirely when it isn't verified, not by filtering in the
allowlist check — so an unverified email can never match `allowedEmails` for
*any* check that reads it, including a future one.

> **Security:** Entra ID (and some other IdPs) never send `email_verified`
> on their tokens. `allowedEmails` with `oidcAuthAdapter` against such an IdP
> will never match, even for a real user, because the adapter has no
> verification signal to trust. Use `allowedRoles` instead for those IdPs.

## "admin" is a separate tier

Every mapping gates the `"admin"` action (settings/onboarding/bootstrap
writes — they reparameterize what the next boot trusts) separately from
ordinary content writes: it needs `adminRoles` set and an intersecting role,
full stop. An unmapped `adminRoles` (not configured) denies rather than
falling back to `allowedRoles` — a host must opt in to who gets to
reconfigure the site.

## Wiring each adapter

### Local (dev only)

```ts
import { localAuth } from "@typren/core/auth/local";

const auth = localAuth(); // refuses in production unless allowInProduction is set
```

### NextAuth

```ts
import { nextAuthAdapter } from "@typren/core/auth/next-auth";
import { auth as nextAuth } from "@/auth"; // your NextAuth(config) export

const auth = nextAuthAdapter({
  auth: nextAuth,
  allowedEmails: ["editor@example.com"],
  adminRoles: ["admin"],
});
```

### Clerk

```ts
import { clerkAuthAdapter } from "@typren/core/auth/clerk";

const auth = clerkAuthAdapter({
  allowedRoles: ["org:editor"],
  adminRoles: ["org:admin"],
});
```

`getUser`/`authorize` read Clerk's own `auth()`/`currentUser()` globals
directly; nothing is injected.

### Better Auth

```ts
import { betterAuthAdapter } from "@typren/core/auth/better-auth";
import { auth as betterAuth } from "@/lib/auth";
import { headers } from "next/headers";

const auth = betterAuthAdapter({
  getSession: () => betterAuth.api.getSession({ headers: headers() }),
  allowedEmails: ["editor@example.com"],
  adminRoles: ["admin"],
});
```

Better Auth's admin plugin stores `session.user.role` as a single,
sometimes comma-separated string; pass `rolesFrom` to override extraction if
your project stores roles elsewhere.

### Supabase

```ts
import { supabaseAuthAdapter } from "@typren/core/auth/supabase";
import { createServerClient } from "@supabase/ssr";

const auth = supabaseAuthAdapter({
  client: createServerClient(/* ... */),
  allowedRoles: ["editor"],
  adminRoles: ["admin"],
});
```

Roles are read only from `user.app_metadata` (never `user_metadata`, which a
signed-in user can write themselves from the client — trusting it for
authorization would let any user grant themselves roles).

### Generic OIDC

```ts
import { oidcAuthAdapter } from "@typren/core/auth/oidc";

const auth = oidcAuthAdapter({
  getToken: async () => (await headers()).get("authorization")?.replace(/^Bearer /, "") ?? null,
  issuer: "https://your-tenant.okta.com",
  audience: "your-client-id",
  allowedEmails: ["editor@example.com"],
  adminRoles: ["admin"],
});
```

Without an explicit `jwksUri`, the JWKS location comes from standard OIDC
discovery (`${issuer}/.well-known/openid-configuration`), resolved once and
cached for the adapter's instance lifetime, with a 5-second timeout. Tokens
must carry `exp` and `sub` and be signed with an asymmetric algorithm
(RS256/RS384/RS512, PS256/PS384/PS512, ES256/ES256K/ES384/ES512, EdDSA) —
`none` and `HS*` shared-secret algorithms are never accepted, since either
would let anyone who can read the (public) client config forge a token.

### Cloudflare Access

```ts
import { cfAccessAuthAdapter } from "@typren/core/auth/oidc";

const auth = cfAccessAuthAdapter({
  teamDomain: "acme", // acme.cloudflareaccess.com
  audience: "<the Access application's aud tag>",
  getToken: async () => (await headers()).get("cf-access-jwt-assertion") ?? null,
});
```

Exempt from the allowlist requirement: Access only issues this token after
its own per-application policy (the emails/groups/IdPs an admin configured
for this `aud`) already let the request through, so a verified token here is
already allowlisted by Access itself. `allowedRoles`/`adminRoles` read the
`groups` claim by default, which Access only populates when the team has
SCIM group sync configured — without it every token omits `groups` and role
gating silently denies everyone. Confirm SCIM sync is on before relying on
role gating with this preset.
