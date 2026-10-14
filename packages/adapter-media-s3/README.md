# @typren/adapter-media-s3

One `MediaAdapter` (see [`@typren/core`](../core#readme)) for any S3 API-compatible
object store: Cloudflare R2, Supabase Storage, AWS S3, MinIO. They all speak the same
signed REST API, so one implementation covers all four rather than a per-provider
package.

**Edge-compatible.** No `node:fs`, no `sharp`, fetch + WebCrypto only. It runs on
Cloudflare Workers as well as Node.

## Install

```bash
npm i @typren/adapter-media-s3
```

`@typren/core` is a peer dependency (types only; this package never imports its
runtime code). Depends on the FSL-licensed `@typren/core` the same way the rest of
the editor stack does — see that package's `LICENSE`.

## Usage

```ts
import { createS3MediaAdapter } from "@typren/adapter-media-s3";

const mediaAdapter = createS3MediaAdapter({
  endpoint: "https://<account-id>.r2.cloudflarestorage.com",
  bucket: "my-media",
  region: "auto",
  accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  publicBaseUrl: "https://media.example.com",
  prefix: "uploads/", // optional, but if set MUST end in "/" (see Known limits)
});
```

Pass it as `mediaAdapter` to whatever wires up `@typren/core` (`makeActions`, the
media library UI). `list()`, `upload()` and `delete()` match `MediaAdapter` exactly;
see [`fs-media-adapter.ts`](../core/src/fs-media-adapter.ts) for the reference
filesystem implementation this one mirrors.

## Provider configs

### Cloudflare R2

```ts
{
  endpoint: "https://<account-id>.r2.cloudflarestorage.com",
  bucket: "my-media",
  region: "auto",
  accessKeyId: "<R2 access key id>",
  secretAccessKey: "<R2 secret access key>",
  publicBaseUrl: "https://media.example.com", // a custom domain or R2.dev bucket URL
}
```

Create the access key pair under R2 → **Manage R2 API Tokens**.

### Supabase Storage (S3 endpoint)

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

### AWS S3

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

### MinIO (local dev)

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

## Known limits

- **`publicBaseUrl` MUST be a separate origin from the site/editor.** `upload()`
  allowlists only `image/webp`, `image/avif` and `image/svg+xml`, and sets
  `content-disposition: inline` for SVG — but `inline` does not neutralize script
  an SVG can carry. If `publicBaseUrl` shared an origin with the site or editor, a
  stored SVG could run script with that origin's cookies/DOM (stored XSS). Serving
  media from a distinct domain (a CDN domain, R2.dev, Supabase's storage host) means
  a malicious SVG only ever executes in its own, cookie-less origin.
- **`prefix`, if set, MUST end in `/`.** Construction throws otherwise. A prefix
  without a trailing slash is a shared-bucket collision risk: `"siteA"` also matches
  the key `"siteAB/x"` (plain `startsWith`), so one site's adapter could list or
  delete another's objects. `"siteA/"` can't.
- **Path-style URLs only** (`${endpoint}/${bucket}/${key}`). Covers R2, Supabase,
  MinIO and AWS, but not a bucket that only supports virtual-hosted-style requests.
  Add a `virtualHostedStyle` option building `${bucket}.${host}/${key}` if that's
  ever needed.
- **`list()` omits width/height.** `ListObjectsV2` carries no per-object metadata
  (only `Key`/`Size`/`LastModified`); getting dimensions back needs a `HEAD` request
  per object, or a side manifest written at upload time. `upload()` does store them,
  as `x-amz-meta-width`/`x-amz-meta-height` object metadata, for a future reader that
  wants them.
- **Processing still needs Node.** `processUpload` (in `@typren/core`, validation +
  web-optimization via `sharp`) requires a Node runtime; `sharp` doesn't run on
  Workers. On Cloudflare, run the upload path itself (the Server Action or API route
  that calls `processUpload`) on a Node target (e.g. Vercel, a Node-based host, or a
  CI/build-time pipeline) and have this adapter persist the already-processed file;
  only `list()`/`delete()` and read-side rendering need to run on the Worker. The
  hosted-platform plan's agent-driven tier can instead swap in Cloudflare Images for
  processing, trading `sharp`'s feature set for one that runs on Workers natively.

## Why `aws4fetch`, not `@aws-sdk`

`@aws-sdk/client-s3` is built for long-lived Node processes (its own HTTP client,
credential chain, middleware stack) and its bundle size is unfriendly to a Worker's
startup budget. `aws4fetch` is ~65 KB unpacked, zero dependencies, and signs
requests with the platform's own `fetch`/`crypto.subtle` — exactly the surface this
adapter needs (`PUT`/`GET`/`DELETE` plus SigV4) and nothing else.
