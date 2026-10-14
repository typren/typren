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
runtime code).

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
  prefix: "uploads/", // required; must end in "/"
});
```

Pass it as `mediaAdapter` to whatever wires up `@typren/core` (`makeActions`, the
media library UI).

> **Security:** `publicBaseUrl` must be a separate origin from the site/editor. Media
> uploads allow SVG, and `inline` disposition does not neutralize script an SVG can
> carry; a shared origin risks stored XSS against the site's or editor's cookies.

See the [full reference](https://github.com/typren/typren/blob/develop/docs/site/reference-adapter-media-s3.md)
for every provider config, option, default and error.

## License

[Functional Source License 1.1](./LICENSE), converting to Apache 2.0 two years
after each release, same terms as `@typren/core`. See
[the repository](https://github.com/typren/typren#license) for what that means
in practice.
