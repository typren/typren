---
title: Media storage
description: Choose between the filesystem MediaAdapter and @typren/adapter-media-s3 for R2, Supabase, AWS, or MinIO.
category: Guides
order: 25
---

A `CmsConfig.mediaAdapter` is optional — omit it to disable media management
entirely (image-typed fields still render, just as a plain text input with
no "Browse library" button). Two implementations ship today.

## `createFsMediaAdapter` (default)

```ts
import { createFsMediaAdapter } from "@typren/core";

const mediaAdapter = createFsMediaAdapter({
  dir: "/abs/path/to/public/img",
  publicPath: "/img",
});
```

| Option | What it's for |
|---|---|
| `dir` | absolute path assets are read from/written to |
| `publicPath` | public URL prefix the dir is served under, e.g. `"/img"` |

This is the reference implementation: a flat directory, probed for
dimensions with `sharp` on `list()`. It needs `node:fs` and `sharp`, so it
only runs on a Node server, not an edge runtime.

## `createS3MediaAdapter` (`@typren/adapter-media-s3`)

One `MediaAdapter` for any S3 API-compatible object store: Cloudflare R2,
Supabase Storage, AWS S3, MinIO. They all speak the same signed REST API, so
one implementation covers all four. It is edge-compatible: no `node:fs`, no
`sharp`, just `fetch` and WebCrypto (`aws4fetch` for SigV4 signing, not the
AWS SDK, to keep the Worker bundle small).

```ts
import { createS3MediaAdapter } from "@typren/adapter-media-s3";

const mediaAdapter = createS3MediaAdapter({
  endpoint: "https://<account-id>.r2.cloudflarestorage.com",
  bucket: "my-media",
  region: "auto",
  accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  publicBaseUrl: "https://media.example.com",
  prefix: "uploads/", // optional, but MUST end in "/" if set
});
```

### Provider configs

**Cloudflare R2**

```ts
{
  endpoint: "https://<account-id>.r2.cloudflarestorage.com",
  bucket: "my-media",
  region: "auto",
  accessKeyId: "<R2 access key id>",
  secretAccessKey: "<R2 secret access key>",
  publicBaseUrl: "https://media.example.com",
}
```

Create the access key pair under R2 → Manage R2 API Tokens.

**Supabase Storage (S3 endpoint)**

```ts
{
  endpoint: "https://<project-ref>.supabase.co/storage/v1/s3",
  bucket: "my-media",
  region: "<your project's region, e.g. us-east-1>",
  accessKeyId: "<Storage S3 access key id>",
  secretAccessKey: "<Storage S3 secret access key>",
  publicBaseUrl: "https://<project-ref>.supabase.co/storage/v1/object/public/my-media",
}
```

Generate the S3 credentials under Project Settings → Storage → S3 Connection.

**AWS S3**

```ts
{
  endpoint: "https://s3.<region>.amazonaws.com",
  bucket: "my-media",
  region: "<region>",
  accessKeyId: "<IAM access key id>",
  secretAccessKey: "<IAM secret access key>",
  publicBaseUrl: "https://my-media.s3.<region>.amazonaws.com",
}
```

Scope the IAM credentials to `s3:GetObject`/`PutObject`/`DeleteObject`/`ListBucket`
on just this bucket.

**MinIO (local dev)**

```ts
{
  endpoint: "http://localhost:9000", // http:// is only allowed for localhost/127.0.0.1
  bucket: "my-media",
  region: "us-east-1", // MinIO ignores the value but SigV4 still needs one
  accessKeyId: "minioadmin",
  secretAccessKey: "minioadmin",
  publicBaseUrl: "http://localhost:9000/my-media",
}
```

### Prefix rules

If set, `prefix` must be non-empty and end in `"/"` — construction throws
otherwise. A prefix without a trailing slash is a shared-bucket collision
risk: `"siteA"` also matches the key `"siteAB/x"` under a plain
`startsWith` check, so one site's adapter could list or delete another
site's objects. `"siteA/"` can't.

### Separate origin, required

> **Security:** `publicBaseUrl` must be a separate origin from the site or
> editor. `upload()` allowlists only `image/webp`, `image/avif`, and
> `image/svg+xml`, and sets `content-disposition: inline` for SVG — but
> `inline` does not neutralize script an SVG can carry. If `publicBaseUrl`
> shared an origin with the site or editor, a stored SVG could run script
> with that origin's cookies and DOM (stored XSS). Serve media from a
> distinct domain (a CDN domain, R2.dev, Supabase's storage host) so a
> malicious SVG only ever executes in its own, cookie-less origin.

### `processUpload` needs Node

`processUpload` (in `@typren/core`: validation plus web-optimization via
`sharp`) requires a Node runtime — `sharp` doesn't run on Workers. On
Cloudflare, run the upload path itself (the Server Action or API route that
calls `processUpload`) on a Node target (Vercel, a Node-based host, or a
CI/build-time pipeline) and have `createS3MediaAdapter` persist the
already-processed file; only `list()`/`delete()` and read-side rendering need
to run on the Worker.

### Known limits

- `list()` omits width/height: `ListObjectsV2` carries no per-object
  metadata beyond `Key`/`Size`/`LastModified`. `upload()` does store them as
  `x-amz-meta-width`/`x-amz-meta-height` object metadata, for a future reader
  that wants them.
- Path-style URLs only (`${endpoint}/${bucket}/${key}`) — covers R2,
  Supabase, MinIO, and AWS, but not a bucket that only supports
  virtual-hosted-style requests.
