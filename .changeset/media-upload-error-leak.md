---
"@typren/core": patch
---

`handleMediaUpload` no longer echoes a `MediaAdapter.upload()` failure's raw message to the client (it can carry storage paths, bucket names, or other backend detail); it now returns a generic "Upload failed" with the original status code and logs the detail via `console.error`. `processUpload`'s own validation errors (unsupported format, size limit, SVG disabled) are unchanged, since those are deliberately user-facing.
