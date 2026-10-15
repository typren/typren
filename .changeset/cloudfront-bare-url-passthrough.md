---
"@typren/adapter-cloudfront": minor
---

`readFunctionSource({ trailingSlash: false })` now reads a second,
hand-written viewer-request function (`redirects-bare-url.function.js`)
roughly symmetric to the default one: slash form 301s to the bare form,
bare extensionless pages rewrite to their `.html` object. `bootstrap` gains
`--trailing-slash` (keep in sync with `sync-redirects`' own flag) to select
it, and `--extra-passthrough <seg,seg>` to template in a site's own
extensionless file-convention routes alongside the built-in Next metadata
names. Segments are validated (bare path-segment characters only) and
`JSON.stringify`'d into the published function's JS source, never
string-concatenated.
