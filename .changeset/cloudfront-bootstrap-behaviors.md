---
"@typren/adapter-cloudfront": minor
---

`bootstrap` previously attached the viewer-request function to the default
cache behavior only, and its already-attached guard read only that
behavior, so a distribution with extra `CacheBehaviors` (`/assets/*`,
`/api/*`) could silently skip redirects and the index rewrite on those
paths, and a different function parked there went undetected. Add
`--behavior <path-pattern>` (repeatable) and `--all-behaviors` to attach
to extra behaviors (or every behavior) beyond the always-attached default,
and extend the guard to read every behavior on the distribution regardless
of which ones a run targets.

BREAKING (internal, pre-1.0): `CloudFrontClient.setViewerRequestFunction`
now takes a third `behaviors: CacheBehaviorTarget[] | "*"` argument, and
`getAttachedFunctionNames` returns names found on any behavior, not just
the default. Only affects a caller supplying its own `CloudFrontClient`
(e.g. in tests); the AWS-CLI-backed default client and the CLI are
unaffected.
