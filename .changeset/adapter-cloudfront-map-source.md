---
"@typren/adapter-cloudfront": minor
---

`sync-redirects` gains `--map <file>`: a host-supplied redirect map (`.json`
array of `{ from, to }`, or a `.mjs`/`.js` module exporting one) merged with
the content scan's frontmatter aliases. Map targets may be on-site paths
(canonicalized to the trailing-slash form, except file objects) or absolute
http(s) URLs (passed through verbatim); a `from` declared by both sources
fails loudly. A site with no typren content syncs from the map alone, which
makes the canonical function + KeyValueStore + sync usable by any CloudFront
static site, typren or not. `loadRedirectMap` and `mergeRedirectEntries` are
exported for hosts composing their own sync.
