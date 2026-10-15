---
"@typren/forms": minor
---

Add a static-site delivery mode for sites with no server runtime at all:
`submitForm(source, { sink, schema })` validates, checks the honeypot, and
delivers straight to a browser-safe sink from the browser, no handler
required. `assertBrowserSafeSinkConfig` (exported from `@typren/forms/sinks`)
enforces the trust boundary in code: it throws for server-only sink types
(`google-sheets`, `file`) and for any sink config containing a `"${...}"`
reference, so a credentialed sink can never be bundled into client code by
accident.
