---
title: "@typren/adapter-media-s3 reference"
description: Every export, option and error of the S3 API-compatible MediaAdapter.
category: Reference
order: 55
---

`@typren/adapter-media-s3` ships one `MediaAdapter` (see [reference-core](./reference-core.md))
that works against any S3 API-compatible object store: Cloudflare R2, Supabase Storage, AWS S3,
or MinIO. It is edge-compatible: fetch and WebCrypto only, no `node:fs`, no `sharp`, so it runs on
Cloudflare Workers as well as Node.

**Not IaC.** It never creates a bucket or account; it operates against one you already have.

## "."

| Export | Signature | Notes |
|---|---|---|
| `createS3MediaAdapter` | `(opts: S3MediaAdapterOptions) => MediaAdapter` | Validates `opts` (see Errors) before returning the adapter. |
| `S3MediaAdapterOptions` | type | See table below. |

### Options (`S3MediaAdapterOptions`)

| Option | Type | Default | Notes |
|---|---|---|---|
| `endpoint` | `string` | required | Path-style endpoint, e.g. R2's `https://<account>.r2.cloudflarestorage.com`, Supabase's `https://<ref>.supabase.co/storage/v1/s3`, or AWS's `https://s3.<region>.amazonaws.com`. Must be an absolute URL; `http://` is only allowed for `localhost`/`127.0.0.1` (MinIO dev). |
| `bucket` | `string` | required | Must match `^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`. |
| `region` | `string` | `"auto"` | `"auto"` works for R2 and MinIO; AWS and Supabase want their real region. |
| `accessKeyId` | `string` | required | |
| `secretAccessKey` | `string` | required | |
| `publicBaseUrl` | `string` | required | The public URL assets are served from. |
| `prefix` | `string` | required | Key prefix every object is stored/listed under, e.g. `"uploads/"`. **Required and must end in `/`.** With no prefix the adapter would list, and let authors delete, every object in the bucket; a prefix missing its trailing slash is a shared-bucket collision risk (`"siteA"` also matches the key `"siteAB/x"` via plain `startsWith`). |

> **Security:** `publicBaseUrl` must be a separate origin from the site/studio. `upload()`
> allowlists only `image/webp`, `image/avif` and `image/svg+xml`, and sets
> `content-disposition: inline` for SVG, but `inline` does not neutralize script an SVG can
> carry. If `publicBaseUrl` shared an origin with the site or studio, a stored SVG could run
> script with that origin's cookies and DOM (stored XSS). Serving media from a distinct domain
> means a malicious SVG only ever executes in its own, cookie-less origin.

### `MediaAdapter` behavior

| Method | Signature | Notes |
|---|---|---|
| `list()` | `Promise<MediaAsset[]>` | Full bucket scan via `ListObjectsV2`, capped at 100 pages; a repeated continuation token is rejected rather than looped on. Sorted newest first. Omits `width`/`height` (`ListObjectsV2` carries no per-object metadata); `upload()` does store them as `x-amz-meta-width`/`x-amz-meta-height` object metadata for a future reader. |
| `upload(file)` | `Promise<MediaAsset>` | Rejects any mime outside `image/webp`, `image/avif`, `image/svg+xml`. Keys get a random suffix (never overwritten, so writes never race on existence), and `cache-control: public, max-age=31536000, immutable`. |
| `delete(id)` | `Promise<void>` | Idempotent: a 404 from the store is a no-op, not an error. Refuses to delete a key outside this adapter's own `prefix` (a shared bucket may hold another site's objects under a different prefix). |

Signing is via `aws4fetch` (SigV4, zero dependencies, fetch-only) rather than `@aws-sdk`, whose
Node-oriented clients and bundle size don't fit a Worker's startup budget. URLs are path-style
only (`${endpoint}/${bucket}/${key}`); a bucket needing virtual-hosted-style requests isn't
supported.

> **Cost:** `list()` has no pagination cursor exposed to the caller: every call scans the whole
> bucket (up to 100 pages). Fine under roughly 5k objects; a larger library pays for a full scan
> on every media-library open.

## Errors

| Thrown from | Message prefix | Cause |
|---|---|---|
| construction | `adapter-media-s3 endpoint must be an absolute URL` | `endpoint` fails `new URL()`. |
| construction | `adapter-media-s3 endpoint must be https://` | `endpoint` is `http://` and not localhost/127.0.0.1. |
| construction | `adapter-media-s3 bucket name is invalid` | `bucket` fails the bucket-name regex. |
| construction | `adapter-media-s3 prefix is invalid` | `prefix` isn't a string, fails the prefix regex, or contains `..`. |
| construction | `adapter-media-s3 prefix "..." must be non-empty and end in "/"` | `prefix` omitted, empty, or missing its trailing slash. |
| `upload()` | `adapter-media-s3 upload() rejects mime "..."` | Uploaded file's mime isn't in the allowlist. |
| `delete()` | `media id "..." is outside this adapter's prefix` | The id doesn't start with this adapter's configured `prefix`. |
| `list()` | `adapter-media-s3 list() exceeded 100 pages for prefix "..."` | The bucket/prefix is too large to list in one call. |
| `list()` | `adapter-media-s3 list() got a repeated continuation token from the provider` | Guards against an infinite loop from a misbehaving provider. |
| any method | `S3 <op> <path> failed (<status>)` | A non-2xx response from the store; never includes request headers or the signed `Authorization`. |
| `assertSafe` (internal) | `unsafe media id "..."` | An id reaching `delete()`/`upload()` isn't a plain, traversal-free S3 key. |

## Provider configs

| Provider | `endpoint` | `region` | `publicBaseUrl` |
|---|---|---|---|
| Cloudflare R2 | `https://<account-id>.r2.cloudflarestorage.com` | `"auto"` | a custom domain or R2.dev bucket URL |
| Supabase Storage | `https://<project-ref>.supabase.co/storage/v1/s3` | your project's region | `https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>` |
| AWS S3 | `https://s3.<region>.amazonaws.com` | your region | `https://<bucket>.s3.<region>.amazonaws.com` |
| MinIO (local dev) | `http://localhost:9000` | any value (ignored, SigV4 still needs one) | `http://localhost:9000/<bucket>` |

See [media-storage](./media-storage.md) for the fuller fs-vs-S3 decision guide and wiring walkthrough.
