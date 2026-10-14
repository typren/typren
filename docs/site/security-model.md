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

## SVG sanitization

Uploaded SVGs go through `processUpload` → `sanitizeSvg`, which runs
DOMPurify's `svg`/`svgFilters` profiles (an allowlist, via `jsdom`) to strip
`<script>` tags, event-handler attributes (`onload`, `onclick`, ...), and
`javascript:`/`data:text-html` URIs, while keeping the rest of the markup
intact. This replaced an earlier blocklist-regex approach: a blocklist only
ever covers the bypasses someone already thought of, which stopped being
good enough once upload access could extend beyond an `authorize()`-gated
author (a hosted, multi-tenant setup).

All uploads are additionally mime-sniffed from actual bytes
(`sharp(...).metadata()`), never trusted from the client's `Content-Type`
header or filename extension, both of which are attacker-controlled.

## A separate origin for media

`@typren/adapter-media-s3`'s `publicBaseUrl` must be a separate origin from
the site/editor — serving uploaded SVGs (even sanitized ones) or arbitrary
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
