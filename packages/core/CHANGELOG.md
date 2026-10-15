# @typren/core

## 0.5.1

### Patch Changes

- e78fa80: `clerkAuthAdapter` now binds org roles to an `organizationId` option, required whenever
  `allowedRoles` or `adminRoles` is set, and only counts a role while that org is the session's
  active org (session token v1 `org_id`/`org_role` and v2 `o.id`/`o.rol` are both read). Before,
  any user who created their own organization was its `org:admin` and passed the role checks. The
  `"admin"` action also has to pass `allowedUserIds`/`allowedEmails`/`allowedRoles` first now.
  This changes the adapter's API; see `docs/migrations/core-0.5.0.md`.
- d8b5925: Bound front-matter writes by node count before dumping. Writes inline every shared object reference, so a ~1 KB editor payload built as a DAG of shared references expanded exponentially and exhausted the server's memory before the 256 KB size cap was checked. Such payloads, and circular ones, now fail fast with a "front matter too large" error; ordinary shared references (a duplicated slice) still save.
- dc12381: `localAuth()` now requires the Next server to be bound to loopback (`next dev -H 127.0.0.1`) and denies every request otherwise. The loopback `Host` check it relied on before is client-controlled, so a LAN client could spoof `Host: localhost` against a dev server listening on all interfaces (Next's default) and write content and media. Update your `dev` script if editor writes start failing in development; see the core 0.5.0 migration note.
- 38ee2d8: `handleMediaUpload` now refuses a cross-origin request with 403 (a cross-site `Sec-Fetch-Site`, or an `Origin` whose host isn't the request's). A multipart POST needs no CORS preflight, so any web page could previously upload to a developer's loopback dev server through a standalone media route. A host serving the editor from another origin passes it as the new optional `allowedOrigins` argument; `createTyprenApi` forwards its own `allowedOrigins`.
- 8db92cc: `nextAuthAdapter` now requires an `isEmailVerified(session)` callback whenever `allowedEmails` is
  set, and only lets the session email satisfy the allowlist when it returns `true`. NextAuth's
  session carries no verified-email signal, so an address from a provider that never verified it
  used to pass. This changes the adapter's API; see `docs/migrations/core-0.5.0.md`.
- bd91499: Fix a stored-XSS path in the Notion block converter: an inline-code run containing a line break ended its paragraph inside the would-be code span, so the rest of the run (for example `<div><img onerror=...></div>`) rendered as live HTML. Line endings inside inline code now collapse to spaces, which is how CommonMark renders them anyway.
- 1d632a0: Fix two stored-XSS paths in the Notion block converter: a nested code block's content lines weren't indented to match their list/quote/to-do container, letting the fence (and a payload like `<img onerror=...>`) break out as a top-level HTML block; and plain Notion text and bookmark/image captions weren't escaped for markdown metacharacters, letting a caption like `a](javascript:...) [b` or literal text `[x](javascript:...)` close its wrapper early and become a live, script-executing link.
- 7183ffa: Security review (group "yaml"): `createMarkdownAdapter` and `createGithubAdapter`
  now serialize front matter through the same safe path their `parse()` already
  used, instead of gray-matter's raw `stringify`.
  
  - Front matter is dumped with YAML anchors/aliases disabled (`noRefs: true`).
    Without it, a page whose slices share a nested object reference (as the
    editor's Duplicate control produces via a shallow copy) serialized to an
    anchor/alias pair that `parseMatter` refuses to read back: a saveDraft or
    Duplicate could make a page permanently unreadable, failing every build and
    listing that parses it.
  - Serializing now enforces the same front-matter size cap `parseMatter`
    enforces on read, by reading the result back with `parseMatter` before
    returning it. Oversized front matter now throws before anything is written,
    instead of writing a file no parser can ever read again.

## 0.5.0

### Minor Changes

- b0aa508: BREAKING: `ContentAdapter` and `ContentStore` are now fully async (issue #29),
  `ContentAdapter.root` was removed from the interface in favor of the exported
  `MarkdownAdapter` type, and the Notion adapter's `spawnSync` bridge is gone in
  favor of a plain `fetch`. See
  [`docs/migrations/core-0.5.0.md`](../docs/migrations/core-0.5.0.md) for the
  fix-up steps, or run `npx typren migrate` once it ships.
  
  Also new: `createGithubAdapter`'s `readInit` option for host-cache-tagged
  content reads, and `@typren/core/github-webhook` for invalidating that cache
  on a GitHub push (issue #29's "git runtime").
- d2c9f03: Add `AuthAdapter` mappings for Better Auth, Supabase, and generic OIDC/JWT
  (covering Okta, Entra ID, Auth0, Keycloak, and Google Workspace SSO), plus a
  `cfAccessAuthAdapter` preset for Cloudflare Access, so hosts can wire SSO,
  passkeys, magic links, and enterprise IdPs without Typren implementing any
  login flow itself.
- 07a5280: Redirects can now carry a per-entry HTTP status (301, the default, or
  302/307/308), closing the gap for migrators from `_redirects`/`vercel.json`
  who expect a temporary (302) or method-preserving permanent (308) redirect
  instead of a hardcoded 301. A `--map` entry sets it with a `status` field
  (`{ "from": "/old", "to": "/new", "status": 302 }`); `@typren/core`'s
  `toRedirectPairs` encodes it as a `"<status> <target>"` prefix on the stored
  value, and `resolveStaticHostRequest`, the CloudFront function, and the
  Cloudflare Worker all decode it the same way (an unrecognized status prefix
  is an invalid entry and fails open, same as any other invalid target).
- e20d2b8: Fix a GitHub-backed site's markdown mirror route listing every page on each
  request instead of checking one slug's existence, bound the concurrent
  fan-out `listPages`/sitemap/llms.txt/redirects open over a site's slugs, give
  `createGithubAdapter` a real optimistic-lock upgrade path
  (`ContentAdapter.writeRaw`/`writeDraftRaw` now take an optional
  `opts.expectedVersion`), and serialize its writes so concurrent per-locale
  deletes can't race each other's cached blob sha.
  
  `createGithubAdapter` also gains `draftBranch`, defaulting to
  `"typren-drafts"`: drafts now live on their own branch by default instead of
  the published branch, created lazily on first draft save. Pass
  `draftBranch: null` to keep the previous single-branch layout. See
  docs/migrations/core-0.5.0.md.
- b95f3cd: SVG uploads are now off by default. Set `allowSvg: true` in `CmsConfig` to accept them, and serve media from a
  separate origin or with `Content-Security-Policy: sandbox` (see docs/site/media-storage.md). Allowed SVGs also
  lose `<style>`, `<image>` and any `href` that is not a same-document `#fragment`. WebP and AVIF uploads are now
  re-encoded like every other raster format, which strips EXIF/GPS metadata and applies the 2000 px cap, and
  `handleMediaUpload` refuses a body whose `Content-Length` is over the limit before buffering it.

### Patch Changes

- 11b4619: Fix several `AuthAdapter` review findings:
  
  - OIDC, Better Auth, and Supabase mappings now omit `email` from the
    resolved `AuthUser` unless the provider reports it verified
    (`email_verified`, `session.user.emailVerified`, `email_confirmed_at`), so
    an unverified or unconfirmed email can never match `allowedEmails`.
  - `oidcAuthAdapter`'s discovery fetch now times out after 5s instead of
    hanging the adapter open, and `jwtVerify` requires `exp`/`sub` claims.
  - Better Auth's `rolesFrom` override normalizes a non-array result to no
    roles instead of leaking a bad shape to callers.
  - The allowlist's email comparison is ASCII-only: an email containing a
    non-ASCII character never matches, closing a locale-dependent lowercasing
    mismatch.
- 3e432fe: Dependency updates: next 16.4.0, dompurify 3.4.17, js-yaml 5.4.3, jsdom 30.1.2 and dev tooling (vitest, eslint,
  typescript-eslint, @types/node, @vitejs/plugin-react, lucide-react).
- 52e172a: Content parsing now refuses JavaScript front matter (`---js` / `---javascript`) in the markdown and GitHub
  adapters, so a content file can never execute code when it is parsed.
- 1130d81: Hardening pass on `typren migrate` and the breaking-change migration gate,
  all bug fixes with no API change:
  
  - `typren migrate` now drops (with a warning) a `--remote` note whose
    package/version isn't validly shaped, strips control characters from a
    remote note's title/body, and caps the remote fetch to 1 MB while
    streaming instead of after buffering the whole response.
  - `@typren/core`'s published package now also carries a `migrations/.min-version`
    file (the oldest migration note it kept); `migrate` reads it and warns
    (exiting non-zero) when a project's `--from` predates it, since older
    notes it may have needed were dropped from this release.
  - The project file walk `migrate` runs to detect matches no longer follows
    symlinks, caps per-file reads at 1 MB, reads each file once regardless of
    how many detect patterns/notes apply to it, and ignores a few more
    generated-output directories (`coverage`, `build`, `.turbo`, `.vercel`,
    `.svelte-kit`, `.output`).
  - Every `execFileSync("git", ...)` call in the CLI (`review`'s git-backed
    checks, and `--pr`'s checkout/commit/push) now runs with `envWithoutGit()`,
    closing the same inherited-`GIT_DIR` hazard `migrate`'s own git calls were
    already guarded against.
  - `bun run check:migrations` is now part of the local `pre-push` gate (it was
    already part of `bun run verify`, so CI already ran it); the gate itself
    now requires a migration note's version to exactly match the version a
    changeset's bump produces (not just any later version), tolerates
    CRLF/unquoted-or-single-quoted changeset frontmatter, and only enforces
    itself against packages whose notes are actually packed into the CLI
    (`@typren/core`; others get an informational note instead of a failure).
- f5ec0c8: Round 2 of the auth/settings/proxy security review:
  
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
- f5580aa: `createGithubAdapter`'s `listSlugs` now skips files whose names are not valid slugs instead of listing them,
  so one stray file in the content directory no longer breaks every page listing that reads it.
- c6f38fa: Notion block conversion now escapes `<`, `>` and `&` in text, keeps only http(s)/mailto link and image URLs
  (other links keep their text), fences code so its content cannot close the fence, and refuses component
  directive names outside `[A-Za-z0-9_-]`. A Notion page can no longer inject HTML into the rendered markdown.
- 8be319f: The GitHub webhook handler now records a delivery id as processed only after `onChange` succeeds, so GitHub's
  retry of a delivery whose `onChange` failed is processed instead of being dropped as a replay.
- 87ec75b: Front matter now refuses YAML aliases (`*ref`) and blocks over 256 KB, so a content file can no longer
  expand into gigabytes of objects (billion laughs) when it is parsed. Timestamps, merge keys and every other
  value parse exactly as before.
- d054689: Add `typren migrate`: reads the migration notes bundled with the installed
  `@typren/core` (`migrations/`, packed at build time from `docs/migrations/`)
  and checks the project against each one's `detect` patterns, printing
  file:line matches plus the note's Fix/Verify steps. `--remote` additionally
  checks `https://typren.com/migrations/index.json` for notes newer than the
  install, labelled unverified since they aren't pinned by the lockfile.
  
  `@typren/core` ships the `migrations/` directory (now in its package `files`)
  but no notes yet; this is a non-breaking addition and bumps patch.
  
  Also adds the breaking-change migration gate (`bun run check:migrations`,
  wired into `bun run verify`): a changeset whose body starts with `BREAKING:`
  must have a `docs/migrations/<package>-<version>.md` ahead of that package's
  current version, or `verify` fails with the missing file named.

## 0.4.0

### Minor Changes

- 7e13dc1: Add `@typren/core/static-host` (`resolveStaticHostRequest`), covering both
  static-export URL shapes: `trailingSlash: true` (the default) and Next's default
  bare URLs via `{ trailingSlash: false }`. Add host-agnostic redirect sourcing
  (`scanContentStore`, `loadRedirectMap`, `mergeRedirectEntries`,
  `toRedirectPairs`).

## 0.3.3

### Patch Changes

- aa2ebce: Bump runtime dependencies: dompurify 3.4.16, js-yaml 5.4.2, jsdom 30.1.1, sharp 0.35.5.

## 0.3.2

No changes in this release.

## 0.3.1

### Patch Changes

- ff519d8: `@typren/core/seo`'s `markdown-route` now imports `next/server.js` instead of
  bare `next/server`. next@16 ships no `exports` map, so subpaths resolve as
  plain file paths — and Node's ESM resolution requires the extension there,
  which is why any Node-resolution consumer (vitest with the dep externalized,
  raw node ESM) importing `@typren/core/seo` hit `Cannot find module
  '.../next/server' — Did you mean to import "next/server.js"?`. Bundler
  consumers (Turbopack, webpack, vite) resolve `next/server.js` identically to
  the old bare specifier, so this is a no-op for them.

## 0.3.0

### Minor Changes

- fdb04a5: `buildSitemap` no longer stamps build time as every page's `lastmod`. A page
  that declares `sitemap.lastModified` in frontmatter (`YYYY-MM-DD` or full ISO
  datetime) has it passed through verbatim; every other page now omits `lastmod`
  entirely. Stamping build time told crawlers the whole site changed on every
  deploy, which teaches them to discount the signal — omission is valid per the
  sitemap protocol and honest. Breaking for anyone relying on the old build-time
  `lastModified` being present on every entry.

### Patch Changes

- 4a519e8: Security and correctness fixes from a repo-wide audit. adapter-cloudfront: the viewer-request function no longer emits protocol-relative redirect Locations (open redirect), preserves query strings on 301s, and emits canonical single-hop KVS targets; `setViewerRequestFunction` merges function associations instead of overwriting every event type. core: the locale router's redirect pathname collapses leading slashes (same open-redirect class), settings fall back to the default locale and detect draft-only versions, `listSlugs` skips non-slug filenames instead of throwing, `filePolicy` wildcard rules no longer apply to identities without an `@`, and the Notion adapter passes its token over stdin instead of child-process argv. cli: shared version read.

## 0.2.2

### Patch Changes

- e7c422f: Update all dependencies to latest, consolidating the open Dependabot PRs (#57–#61): js-yaml 5 (named exports, bundled types), jsdom 30, vitest 5, TypeScript 6 (typescript-eslint does not support TS 7.0 yet), @types/node 26, eslint 10.10 / @eslint/js 10, plus minor and patch bumps across the workspace. Package tsconfigs now declare `"types": ["node"]` explicitly, as TS 6+ no longer auto-includes hoisted @types packages.

## 0.2.1

## 0.2.0

### Minor Changes

- 38548ca: Add `content: "slices"` to `createNotionAdapter`: a Notion page now reads as
  a full typren page record whose `PageContent.slices` come from running the
  page's block tree through `blocksToSegments`/`pageRecordFrom` (prose runs
  become a `"prose"` markdown slice, `::componentName` directives become named
  slices, in document order) — the `content: "blocks"` mode's plumbing, now
  also wired into a real `slices` array instead of only a flattened markdown
  `body`. The host's own slice registry resolves each name at render time; an
  unregistered name is that registry's fallback to handle (unchanged), never
  a throw from this adapter. Read-only for now: `writeRaw`/`writeDraftRaw`
  still only push `properties`, with a loud one-time `typren:` console warning
  (not a silent drop) when a write would have carried slice edits — mirroring
  `content: "blocks"`'s existing body-write warning. Additive; no behavior
  change for `content: "none"` or `"blocks"` collections.
- 5d27c77: Added `buildRedirects(store, opts?)`, a framework-agnostic redirects API driven by page frontmatter: a page declares its own old URLs via `aliases: string[]` instead of every host hand-maintaining a redirect config. Validates absolute paths, rejects an alias that shadows another page's canonical path (including a page aliasing itself), de-duplicates across the whole site, and caps total entries (`maxEntries`, default 1000). Hosts turn the returned `RedirectEntry[]` into whatever their infra wants — Next `redirects()`, a Netlify/Cloudflare `_redirects` file, `vercel.json`, an nginx map, or a CloudFront KeyValueStore (see the new `@typren/adapter-cloudfront`).

### Patch Changes

- a6e618b: Add a Notion-backed `ContentAdapter` (`createNotionAdapter`,
  `createFetchNotionClient`) and let a `CollectionSection` take a pre-built
  `adapter` instead of `dir` for non-filesystem backends. The Notion adapter's
  property mapping is generic (driven entirely by a caller-supplied
  property-type map, no site/entity knowledge); `content: "blocks"` optionally
  reads a page's own block content (paragraphs, headings, lists, tables,
  toggles, ...) as markdown via a new pure block converter
  (`blocksToMarkdown`/`blocksToSegments`/`pageRecordFrom` in `notion-blocks.ts`),
  including a generic `::componentName` directive convention for calling a
  site's own components from inside a Notion page. Block writes are
  read-only for now (a loud `typren:` TODO marks the deferred write-back).
  All additive, no behaviour change for existing markdown-backed collections.

## 0.1.4

### Patch Changes

- 8cfe390: Bump dependencies: sharp 0.35.4, and dev-only updates (@types/node 26, next 16.3.4, @testing-library/react 16.3.3, @types/react-dom 19.2.5). No runtime behaviour change.

## 0.1.3

### Patch Changes

- cc9b5aa: Replace the polynomial dash-trim regex (`/^-+|-+$/g`) with an equivalent linear one in the three slugify sites (store, sections, media). Behavior is unchanged — after the alnum collapse consecutive dashes cannot occur — but hostile input can no longer trigger quadratic backtracking. Closes the three CodeQL alerts.

## 0.1.2

### Patch Changes

- Prepare the `typren` CLI for its first npm release, and align the `typren init` scaffold with what is actually published. The scaffold no longer emits the unpublished `@typren/editor` UI: the editor routes are gone, the content Server Actions now live in `cms-actions.ts`, and the media upload route now lives at `app/media/upload/route.ts`. The CLI gains `--version`, a `typren telemetry on|off` command (inert until a collector endpoint exists, disabled by `DO_NOT_TRACK`, `TYPREN_TELEMETRY=0`, or `CI`), and `typren review` now detects its paths instead of assuming a fixed layout, overridable via a `review` key in `typren.config.json`. CLI packaging is now npm-correct: `@typren/core` is declared as a semver range instead of `workspace:*`, and LICENSE and README ship in the package.
  
  This core release matters for the CLI even though the core API is unchanged: `buildTemplates` lives in `@typren/core/templates/init`, so the CLI must resolve a core version that contains the editor-free scaffold. Publishing the CLI against core 0.1.1 would scaffold imports of the unpublished editor package.

## 0.1.1

### Patch Changes

- Patch sharp to close four high-severity libvips CVEs (CVE-2026-33327,
  CVE-2026-33328, CVE-2026-35590, CVE-2026-35591). The fix shipped in sharp
  0.35.0, which `^0.34.5` could never reach, so this raises the range to
  `^0.35.3`.
  
  sharp 0.35 also folded AVIF detection into its heif decoder, so an AVIF upload
  now reports format `heif` with compression `av1` rather than a dedicated
  `avif` format. The upload guard checks compression alongside format, which
  keeps AVIF passthrough working without silently starting to accept plain HEIC.
  
  Adds a package README, so the npm page describes the package instead of
  showing nothing.
