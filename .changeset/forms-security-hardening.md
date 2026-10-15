---
"@typren/forms": patch
---

Harden `createFormHandler` and the bundled sinks per security review:

- The handler now reads the request body incrementally and rejects once the
  actual bytes exceed `maxBodyBytes` (default 64 KB, configurable), instead
  of trusting `Content-Length`, which a chunked request never sends.
- Every field without its own `maxLength` is capped at 10,000 characters
  before `pattern` ever runs against it.
- A failed sink's `detail` no longer reaches the public JSON response; it is
  only ever passed to `logger` (`console.error` by default).
- The `webhook` sink now sets `redirect: "manual"` and treats a 3xx response
  as a failed delivery instead of following it.
- The `file` sink rejects (rather than writes a partial line for) a
  submission whose serialized JSONL line exceeds 64 KB.
