---
title: Security checklist
description: Deploy-time checks before a Typren site goes live.
category: Operations
order: 72
---

Run through this before a site goes to production. Each item links to the
guide that explains the reasoning; this page is the checklist form.

## Auth

- [ ] `auth` is set to a real `AuthAdapter`, not the dev-only `localAuth()`
      fallback. (`localAuth()` also refuses a non-loopback request `Host`
      even in development, but it is still never a production adapter.)
- [ ] Every email allowlist entry is backed by an identity provider that
      actually sends a **verified**-email signal (OIDC `email_verified`,
      Clerk's primary-email verification status, Better Auth
      `emailVerified`, Supabase `email_confirmed_at`). `next-auth` has no
      verification signal at all — use `allowedRoles` there. An IdP that
      never sends one (Entra ID, notably) must use `allowedRoles` instead —
      an allowlist against an unverified email is not a security boundary.
      `cfAccessAuthAdapter` is the one exception: it trusts Access's own
      email, which Access has already verified upstream.
- [ ] A new auth mapping with no allowlist configured fails to construct
      (throws), except `cfAccess` — this now includes `next-auth` and
      `clerk`, which used to be default-open; confirm this wasn't bypassed
      with an empty-but-present allowlist.
- [ ] OIDC: discovery has a 5-second timeout and tokens are checked for
      `exp` + `sub` and an asymmetric signing algorithm before anything else
      runs.
- [ ] Settings writes (`createSettingsStore`) require the distinct `"admin"`
      auth action — confirm page-editor roles were not accidentally granted
      site-reconfiguration rights.
- [ ] A bootstrap patch (`PUT /settings/bootstrap`) is validated server-side,
      not just by the CLI: known keys only, `locales` are BCP-47-ish strings
      with `defaultLocale` among them, `adminRoute` matches `^[a-z0-9-]+$`
      and isn't `api`/`_next`, `routing` is a recognized enum value, and
      `onboarded` is a boolean. `createSettingsStore` throws at construction
      if `siteId` (or another multi-tenant/factory signal) is set with no
      `settingsAdapter` configured.
- [ ] If you renamed `adminRoute`, the old `/editor/**` path still serves the
      editor unless your proxy opts in: call `typrenBlocksDirectEditorAccess(url)`
      from `@typren/core/proxy` ahead of `typrenProxyRewrite` and return a 404
      when it is true. Renaming alone hides nothing.

See [auth-model](./auth-model.md) and [choosing-auth](./choosing-auth.md).

## Content adapter

- [ ] If using `createGithubAdapter`: the installation token is scoped to
      exactly the repo(s) it needs, never a personal access token with
      broader org access.
- [ ] `draftBranch` is set (default `"typren-drafts"`) and the host's CI/CD
      is configured to **ignore builds** on it (Vercel's Ignored Build Step,
      Cloudflare Pages' branch build controls) — a host that builds every
      branch will otherwise preview/deploy unpublished drafts.
- [ ] The GitHub webhook route has a non-empty `secret` and verifies
      `X-Hub-Signature-256` — a webhook with no secret is an unauthenticated
      endpoint that lets anyone trigger cache invalidation (or worse, if
      `onChange` does anything beyond revalidation) by guessing the URL.
- [ ] If using `createSettingsStore` with a non-filesystem Pages adapter
      (GitHub, Notion): `settingsContentAdapter` is set and points at a
      **distinct, non-overlapping** location — the constructor throws if it
      shares the Pages adapter instance or root, but confirm it wasn't
      pointed at a sibling path that still overlaps.

See [security-model](./security-model.md) and
[live-content-github](./live-content-github.md).

## Media

- [ ] `publicBaseUrl` (fs or S3-compatible media adapter) is a **separate
      origin** from the site and the editor — a same-origin stored SVG can
      run with the site's own cookies and DOM, defeating the sanitizer
      below.
- [ ] SVG uploads are rejected by default; `allowSvg: true` is only set when
      the site actually needs them, and the separate-origin rule above holds
      if it is. Allowed SVGs are still sanitized (DOMPurify, SVG profile,
      plus `style`/`image` tags and non-fragment `href`/`xlink:href` values
      forbidden) before storage — confirm a custom upload path doesn't
      bypass it.
- [ ] WebP/AVIF uploads are re-encoded through `sharp` (strips EXIF/GPS,
      caps the maximum dimension) rather than stored byte-for-byte from the
      client.
- [ ] `adapter-media-s3`: `prefix` is set, non-empty, and ends in `/` — a
      prefix without a trailing slash can match another site's keys in a
      shared bucket (`"siteA"` also matches `"siteAB/x"`).
- [ ] Upload MIME allowlist is as narrow as the site needs (the S3 adapter
      allows only `webp`/`avif`/`svg` by default) — don't widen it to accept
      arbitrary uploaded content types.

See [media-storage](./media-storage.md).

## Routing and redirects

- [ ] Frontmatter `aliases` and any redirect map file were validated at
      build time (`buildRedirects`/`loadRedirectMap` throw loud on a
      malformed, shadowing, or duplicate entry) — a build that silently
      swallowed a redirect error was not actually checked.
- [ ] No redirect target is protocol-relative (`//host/...`) — both
      `buildRedirects` and `loadRedirectMap` reject these, since a browser
      resolves them off-site while they read as on-site in review.

See [seo-and-aio](./seo-and-aio.md).

## Forms

- [ ] Every sink credential (`accessToken`, `token`, a webhook
      `authorization` header) is a `"${VAR}"` environment reference, never a
      literal — `requireEnvRef` refuses a literal for credential fields, but
      confirm no config file has one pasted in anyway.
- [ ] A `spamVerifier`, if configured, fails closed on its own errors — this
      is the handler's default behavior; confirm a custom verifier doesn't
      catch-and-return-`true` on every error path (that silently disables
      spam protection during a vendor outage instead of rejecting).
- [ ] The default 64 KB request-body cap and 10,000-character per-field
      `maxLength` are the framework defaults for `createFormHandler` — only
      raise either for a form that genuinely needs it.
- [ ] A HubSpot sink's `hutk` comes from the server-read `hubspotutk`
      cookie, never a value accepted from the form body.

See [forms](./forms.md).

## Operational hygiene

- [ ] `typren migrate --remote` output, if used, is treated as **display
      only** — remote migration notes are untrusted input from typren.com,
      never auto-applied.
- [ ] `check:migrations` runs in `verify` and the pre-push hook (core
      package only) — confirm it wasn't disabled locally.
- [ ] Secrets (installation tokens, webhook secrets, sink credentials,
      OIDC client secrets) are not committed anywhere this repo's own
      content directory, `typren.config.json`, or test fixtures can reach.

See [upgrading](./upgrading.md).
