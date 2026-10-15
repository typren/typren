---
"@typren/adapter-media-s3": minor
---

Initial release: one `MediaAdapter` over any S3 API-compatible object store
(Cloudflare R2, Supabase Storage, AWS S3, MinIO), signed with `aws4fetch` so it
runs on Cloudflare Workers as well as Node.
