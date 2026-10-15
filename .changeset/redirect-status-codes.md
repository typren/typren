---
"@typren/core": minor
"@typren/adapter-cloudfront": minor
"@typren/adapter-cloudflare": minor
---

Redirects can now carry a per-entry HTTP status (301, the default, or
302/307/308), closing the gap for migrators from `_redirects`/`vercel.json`
who expect a temporary (302) or method-preserving permanent (308) redirect
instead of a hardcoded 301. A `--map` entry sets it with a `status` field
(`{ "from": "/old", "to": "/new", "status": 302 }`); `@typren/core`'s
`toRedirectPairs` encodes it as a `"<status> <target>"` prefix on the stored
value, and `resolveStaticHostRequest`, the CloudFront function, and the
Cloudflare Worker all decode it the same way (an unrecognized status prefix
is an invalid entry and fails open, same as any other invalid target).
