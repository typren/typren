---
"@typren/adapter-cloudfront": minor
---

Security and generality hardening from a pre-release review, layered on the
new `--map` source:

- **Content scan can no longer execute code**: gray-matter's `javascript`
  front-matter engine (which eval()s the block) is refused, so a markdown
  file cannot run inside the credentialed sync process.
- **Edge function refuses hostile KVS targets** (protocol-relative,
  backslash, control characters) instead of serving them into a Location
  header, and its extensionless passthrough now matches nested Next metadata
  routes (`/blog/opengraph-image`) and `/.well-known/*`.
- **Map validation matches core's rigor**: rejects whitespace/control/
  backslash values, protocol-relative targets, self-redirects (browser-cached
  301 loops) and entries shadowing a live page's path.
- **Sync safety**: an empty desired state refuses to mass-delete every live
  key without `--allow-empty`; a value-taking flag swallowing the next flag
  (`--map --dry-run`) errors instead of silently running without the map;
  the listKeys ETag is fetched before the listing so a concurrent sync fails
  loud (412) instead of silently losing its changes.
- **Correctness**: on-site targets carrying a query/fragment canonicalize
  intact (`/new?utm=1` no longer becomes `/new?utm=1/`); KVS keys are stored
  percent-encoded, the form the edge compares against; the key byte limit
  applies to the encoded form.
- **`--trailing-slash false`** emits on-site targets verbatim for
  bare-URL-canonical sites (which bring their own function; see the README's
  new "Site shapes" and "Trust boundaries" sections).
- AWS CLI errors now say what's wrong: missing binary or a v1 CLI without
  the `cloudfront-keyvaluestore` commands.
