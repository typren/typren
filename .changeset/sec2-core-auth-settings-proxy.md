---
"@typren/core": patch
---

Round 2 of the auth/settings/proxy security review:

- `nextAuthAdapter` and `clerkAuthAdapter` now REQUIRE an allowlist
  (`allowedEmails`/`allowedRoles`, or `allowedUserIds` for Clerk) at
  construction, matching `betterAuthAdapter`. Without one, any signed-in user
  was authorized for every content-write action.
- `clerkAuthAdapter` reads the verified primary email instead of
  `emailAddresses[0]`, so an unverified secondary address can no longer
  satisfy `allowedEmails`.
- `localAuth` now also requires the request Host to resolve to loopback
  (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`) in addition to the
  existing `NODE_ENV === "development"` check: a dev server bound to
  `0.0.0.0` (common in containers/VMs) previously exposed its
  unauthenticated file writes to anything on the LAN. The scaffold's
  "Start your dev server" step now says to bind with `next dev -H 127.0.0.1`.
- `createMarkdownAdapter` rejects a `locales`/`defaultLocale` entry that
  isn't BCP-47-ish shaped at construction: those values become path
  segments, and only membership in the allowlist was checked before, not
  whether the allowlist's own entries were safe.
- `PUT /settings/bootstrap` now validates the merged bootstrap (known keys
  only, a safe non-reserved `adminRoute`, BCP-47-ish `locales` with
  `defaultLocale` among them, a real `routing` mode) instead of writing
  whatever the patch carried straight through. `validateBootstrap` moves
  from the CLI into `@typren/core` so `typren apply-settings` and this route
  share one rule set.
- `createSettingsStore` throws when `config.siteId` is set (hosted/
  multi-tenant mode) but no `config.settingsAdapter` is given: the default
  bootstrap adapter is a single process-wide file that would otherwise
  collide across tenants.
- `typrenBlocksDirectEditorAccess` (new, `@typren/core/proxy`) lets a host
  404 direct `/editor/**` access after renaming `adminRoute`, which
  previously kept serving at the old path indefinitely.
- Draft, settings, and media-listing GET responses from the HTTP API now set
  `Cache-Control: private, no-store`, and a 500 response no longer echoes
  the thrown error's message (logged server-side instead).
