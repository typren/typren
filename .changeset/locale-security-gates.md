---
"@typren/locale": minor
---

Harden the publish and OTA paths. Locale keys must be BCP-47-ish and every write stays inside its
output directory. `assertNoHtml` is now a DOMPurify allowlist gate (a, b, i, strong, em, ul, ol, li,
p, br, h3, span, code; href and title; http(s), mailto or relative URLs) that fails on anything it
would remove; Node callers pass `createNodePurifier()` from `@typren/locale/build`. The manifest now
carries `deltas` (prior hash -> expected additive hash) and the OTA client verifies deltas and cached
entries only against manifest hashes, re-runs the HTML gate at load (an offending string keeps its
baked value), and accepts a `purifier` option for SSR. The `export-api` source requires the bundle URL
to share the create endpoint's origin or match the new `bundleOrigins` (https exact origin, origin plus
path prefix, or `https://*.suffix`; the `lokalise` and `crowdin` presets ship theirs), and caps zip
bundles at 50 MB inflated and 1000 entries.

Upgrading: rebake so the manifest gains `deltas` (until then the client skips deltas and fetches full
catalogs); a custom `export-api` source whose TMS serves bundles from another host adds that host to
`bundleOrigins`; strings using markup outside the allowlist (for example `target` or `class`
attributes) now fail the bake.
