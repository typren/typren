# @typren/forms

## 0.1.1

### Patch Changes

- 168e325: 0.1.0 was published without its dist (build never ran for the package in the release job); this release repairs the pipeline and republishes with the compiled output.

## 0.1.0

### Minor Changes

- 3cc20c1: New package: form handling for static typren sites. A canonical submission model with server-authoritative validation, honeypot plus pluggable spam verification, a web-standard Request/Response handler that fans out to pluggable delivery sinks (webhook, HubSpot, Google Sheets, JSONL file) with per-sink isolation, and a progressive-enhancement browser submit helper. Credentials travel only as `${VAR}` environment references resolved at deliver time.
