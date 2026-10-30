# @typren/forms

## 0.2.2

### Patch Changes

- ddc554b: Declare a Node.js `engines` floor of `^22.23.4 || ^24.22.1 || >=26.12.1`, the releases that fix the 2026-10-21 Node.js security advisory (Brotli decoder out-of-bounds write, TLS hostname check bypasses). Installing on an older Node now prints an engine warning; nothing fails unless the consumer enables `engine-strict`.

## 0.2.1

### Patch Changes

- bc69c96: The `hubspot` sink now reads `hutk` from the request's `hubspotutk` cookie instead of the submission body, matching the documented guarantee. A submitter could previously claim an arbitrary HubSpot tracking identity by putting any value in the `hutkField`-named form field.
- 52512fc: Every fetch-backed sink (`webhook`, `hubspot`, `google-sheets`) now aborts its request after a 10-second default timeout (override with `SinkRuntime.timeoutMs`), so a slow or unresponsive receiver can no longer pin a form submission handler open.

## 0.2.0

### Minor Changes

- be0a891: Add a static-site delivery mode for sites with no server runtime at all:
  `submitForm(source, { sink, schema })` validates, checks the honeypot, and
  delivers straight to a browser-safe sink from the browser, no handler
  required. `assertBrowserSafeSinkConfig` (exported from `@typren/forms/sinks`)
  enforces the trust boundary in code: it throws for server-only sink types
  (`google-sheets`, `file`) and for any sink config containing a `"${...}"`
  reference, so a credentialed sink can never be bundled into client code by
  accident.

### Patch Changes

- 3e432fe: Dependency updates: next 16.4.0, dompurify 3.4.17, js-yaml 5.4.3, jsdom 30.1.2 and dev tooling (vitest, eslint,
  typescript-eslint, @types/node, @vitejs/plugin-react, lucide-react).
- 2642ec2: Harden `createFormHandler` and the bundled sinks per security review:
  
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

## 0.1.2

### Patch Changes

- 5041c29: Include the LICENSE file (Functional Source License) in the published package.

## 0.1.1

### Patch Changes

- 168e325: 0.1.0 was published without its dist (build never ran for the package in the release job); this release repairs the pipeline and republishes with the compiled output.

## 0.1.0

### Minor Changes

- 3cc20c1: New package: form handling for static typren sites. A canonical submission model with server-authoritative validation, honeypot plus pluggable spam verification, a web-standard Request/Response handler that fans out to pluggable delivery sinks (webhook, HubSpot, Google Sheets, JSONL file) with per-sink isolation, and a progressive-enhancement browser submit helper. Credentials travel only as `${VAR}` environment references resolved at deliver time.
