---
title: Security model
description: Trust boundaries, webhook verification, media origin isolation, and secrets handling.
category: Concepts
order: 14
---

## Trust boundaries live in the adapter

Per [Architecture](./architecture.md), slug, locale, and media-id validation
happen **inside** each adapter, never in a caller. Every shipped adapter
applies its own guard independently, rather than relying on a sibling or an
upstream layer to have already checked:

- **`createMarkdownAdapter`** / **`createGithubAdapter`**: a `SAFE_SLUG`
  regex (`/^[a-z0-9][a-z0-9-]*$/i`) rejects anything that isn't a plain slug
  before it's assembled into a path, closing off `../` traversal. The locale
  is checked against the adapter's own locale allowlist — the primary
  traversal guard for that path segment, since the slug regex alone doesn't
  constrain it.
- **`createGithubAdapter`** additionally validates every path
  (`isAllowedRepoPath`) against its configured content/media roots: rejects
  absolute paths, `../`, any dotfile/dot-dir path segment (which also blocks
  `.github/`), and a fixed list of manifest filenames
  (`package.json`, lockfiles, `tsconfig.json`, etc.) — defense in depth even
  inside an allowed root, since a future GitHub-backed media adapter would
  accept uploader-chosen filenames it can't slug-constrain the way a page
  slug is.
- **`createFsMediaAdapter`**: a `SAFE_NAME` regex plus an explicit `..`
  check on every media id reaching a filesystem call from a Server Action
  argument.
- **`createS3MediaAdapter`** (`@typren/adapter-media-s3`): a `SAFE_ID` regex
  on every key, and a delete additionally confirms the key starts with the
  adapter's own configured `prefix` before deleting: in a bucket shared
  between sites, an id outside this adapter's prefix belongs to someone
  else and must never be deleted here. `prefix` is required and must be
  non-empty and end in `/`; construction throws otherwise. With no prefix the
  adapter would see the whole bucket, and a prefix without a trailing slash
  (e.g. `"siteA"`) also matches another site's keys (`"siteAB/x"`).

## Webhook verification (GitHub push webhook)

`@typren/core/github-webhook`'s `createGithubWebhookHandler` requires a
non-empty `secret` at construction — a webhook endpoint with no secret
would let anyone trigger cache invalidation by guessing the URL. Every
request is verified against `X-Hub-Signature-256` with a constant-time HMAC
compare (walks every byte of the longer input regardless of where a
mismatch occurs, so neither the signature's content nor its length leaks
through timing), checked over the **raw** body before any JSON parsing.

Other protections baked into the handler:

- **Streaming 5MB body cap**: bytes are counted as they stream in and the
  request is rejected (stream canceled, nothing buffered) the moment the
  running total exceeds the limit — closing the gap a `Content-Length`
  header check alone leaves for a chunked request with no length header.
- **Delivery dedupe**: `X-GitHub-Delivery` ids are tracked (bounded,
  in-memory, per handler instance) so a redelivered webhook — GitHub retries
  on any non-2xx, and a host can also manually redeliver — invalidates once,
  not twice.
- **`full: true` fallback**: a force push, an empty commit list, or a commit
  list at GitHub's own per-push cap (2,048) all mean the push can't be
  enumerated reliably, so the handler reports `full: true` rather than a
  (possibly wrong) partial path list, telling the host to invalidate
  everything.

## Front matter: no YAML aliases

`safe-matter` (shared by `@typren/core` and the CLI) parses front matter
with alias expansion disabled (`maxAliasCount: 0`) and a hard cap on the raw
front-matter block's size (256 KB). YAML's `&anchor`/`*alias` syntax lets a
small document expand into an exponential one at parse time ("billion
laughs"); refusing aliases outright, rather than trying to bound expansion,
removes the attack surface instead of tuning around it. A page's front
matter is author-controlled content, so this applies to every parse, not
only ones from an untrusted source.

## SVG sanitization

`processUpload` rejects `image/svg+xml` outright unless the caller opts in
with `allowSvg: true` — SVG is the one upload format that can carry a script,
so it's the one format the framework doesn't accept by default.

When a site does opt in, the upload still goes through `processUpload` →
`sanitizeSvg`, which runs DOMPurify's `svg`/`svgFilters` profiles (an
allowlist, via `jsdom`) to strip `<script>` tags, event-handler attributes
(`onload`, `onclick`, ...), and `javascript:`/`data:text-html` URIs, hardened
beyond the stock profile: `<style>` and `<image>` are added to
`FORBID_TAGS` (both are live script/exfiltration vectors inside an SVG —
`<style>` can carry `@import`/expression-based CSS, `<image>` can point at
an arbitrary URL), and `href`/`xlink:href` are added to `FORBID_ATTR` for
any value that isn't a same-document fragment (`#id`). This replaced an
earlier blocklist-regex approach: a blocklist only ever covers the bypasses
someone already thought of, which stopped being good enough once upload
access could extend beyond an `authorize()`-gated author (a hosted,
multi-tenant setup).

WebP and AVIF uploads are always re-encoded through `sharp` rather than
stored as the client sent them, which strips EXIF/GPS metadata and caps the
maximum dimension. All uploads are additionally mime-sniffed from actual
bytes (`sharp(...).metadata()`), never trusted from the client's
`Content-Type` header or filename extension, both of which are
attacker-controlled, and the upload route checks the request's
`Content-Length` before buffering the body.

## Preview iframe isolation

The studio's live preview renders the draft in an `<iframe sandbox="allow-scripts
allow-forms">` — deliberately without `allow-same-origin`, since combining
it with `allow-scripts` would let the framed page escape the sandbox
entirely (a sandboxed-but-same-origin frame can still reach and script its
parent). The cost is that the frame's origin becomes the opaque string
`"null"`, so the preview bridge can't check `event.origin` the way a
same-origin postMessage protocol normally would. Instead, every message is
checked against `event.source === iframeRef.current?.contentWindow` (so only
the specific frame instance the studio created is trusted, not any other
window) and a `__typren` marker on the message payload. Outbound messages to
the frame use `targetOrigin: "*"`, which is safe here only because nothing
sent to the preview frame is sensitive — it's editable-field content the
author already has, not a credential or session token.

If a future preview route needs same-origin access (cookies, to render a
draft that depends on the visitor's session), the fallback is to drop
`sandbox` entirely and rely on `event.source === iframe.contentWindow` alone
to reject other same-origin windows/frames, plus restricting "edit" messages
to string fields that already exist on the page — never accepting a new
field name or a non-string value from a message. This is a materially
weaker boundary than the sandboxed default and should only be adopted with
that trade-off understood.

## Settings bootstrap validation

`PUT /settings/bootstrap` reparameterizes what the *next* boot trusts (the
admin route, the locale list, the routing mode), so the route validates the
patch server-side rather than trusting whatever the "admin"-gated caller
sends: only known `SiteSettingsBootstrap` keys are accepted, `locales` must
be BCP-47-ish strings with `defaultLocale` among them, `adminRoute` must
match `^[a-z0-9-]+$` and not collide with a reserved path (`api`, `_next`),
and `routing`/`onboarded` must be a recognized enum value / boolean. This is
the same check `typren apply-settings` already ran against
`typren.config.json` at the CLI layer; the server route now enforces it too,
since a hosted deployment's bootstrap write doesn't go through the CLI at
all. `createSettingsStore` also throws at construction if `siteId` (or
another multi-tenant/factory signal) is set without a `settingsAdapter` —
a multi-tenant config with no distinct settings storage would otherwise
silently share one site's settings across every tenant.

## A separate origin for media

`@typren/adapter-media-s3`'s `publicBaseUrl` must be a separate origin from
the site/studio — serving uploaded SVGs (even sanitized ones) or arbitrary
file content from the same origin as authenticated editor sessions/cookies
would be a stored-content risk. The upload-time mime allowlist
(`image/webp`, `image/avif`, `image/svg+xml`) is deliberately narrower than
what `list()` will *display*, for the same reason: an arbitrary uploaded
mime (e.g. `text/html`) served back from `publicBaseUrl` is the risk this
closes off.

## Remote migration notes are display-only

`typren migrate --remote` fetches additional migration notes from
typren.com, on top of the notes bundled with your installed `@typren/core`.
These remote notes are **unverified** — not pinned by your lockfile — and
are display-only: their detect regexes never gate the command's exit code.
Only lockfile-pinned, bundled notes can make `migrate` exit non-zero. Remote
note fields are also sanitized (stripped of ASCII control bytes, validated
package name/semver) before being printed, since they're untrusted input.

## Secrets

- **GitHub adapter tokens**: `createGithubAdapter` takes only a short-lived
  installation access token as plain config; minting or refreshing it
  (GitHub App JWT → installation token exchange) is entirely the caller's
  job. A new token means a new adapter instance — the adapter never derives
  or caches credentials itself.
- **S3-compatible credentials**: `createS3MediaAdapter` signs requests with
  `aws4fetch` and never logs them — a failed-request error includes only the
  method, path, and status, never request headers or the signed
  `Authorization` value.
- **Access-policy files** (`filePolicy`): must live outside whatever your
  `ContentAdapter` can write (`content/**`, the media dir). That's what
  closes the escalation trap — an editor publishing a page can never reach
  the file that decides who's allowed to publish.
