---
title: "@typren/forms reference"
description: Every export, sink option and error of @typren/forms, typren's form-handling package.
category: Reference
order: 53
---

This page documents the public exports of `@typren/forms`, grouped by subpath. See [forms](./forms.md) for a walkthrough.

## "."

The runtime-agnostic core: the schema and canonical `Submission` model, plus server-authoritative validation. Zero dependencies.

| Export | Signature | Notes |
|---|---|---|
| `FieldType` (type) | `"text" \| "email" \| "textarea" \| "select" \| "checkbox" \| "hidden"` | |
| `FormField` (type) | `{ name: string; type: FieldType; required?: boolean; maxLength?: number; pattern?: string; options?: string[] }` | `pattern` is a RegExp source; `validate` anchors it itself, don't include `^`/`$`. `options` only applies to `"select"` fields. |
| `FormSchema` (type) | `{ id: string; fields: FormField[]; honeypot?: string }` | `honeypot` names a field that must arrive empty; it doesn't have to appear in `fields`. |
| `ValidationCode` (type) | `"required" \| "invalid_type" \| "invalid_email" \| "invalid_option" \| "too_long" \| "pattern"` | Per-field codes from `validate()`. |
| `FormErrorCode` (type) | `ValidationCode \| "bad_request" \| "spam"` | The latter two are form-level, added by the server handler, reported with an empty `field`. |
| `ValidationError` (type) | `{ field: string; code: FormErrorCode }` | |
| `ValidationResult` (type) | `{ ok: boolean; errors: ValidationError[] }` | |
| `SubmissionMeta` (type) | `{ submittedAt: string; page?: string; locale?: string }` | `submittedAt` is server-assigned ISO 8601. |
| `Submission` (type) | `{ formId: string; fields: Record<string, string \| boolean>; meta: SubmissionMeta }` | The canonical shape every sink receives. |
| `validate(schema, fields)` | `(schema: FormSchema, fields: Record<string, string \| boolean>) => ValidationResult` | Server-authoritative; the client's own call is UX-only, never trusted. |
| `readFields(schema, body)` | `(schema: FormSchema, body: Record<string, unknown>) => Record<string, string \| boolean>` | Extracts only the schema's declared fields from an untrusted parsed body into a null-prototype record. `__proto__`/`constructor`/`prototype` field names are refused outright; non-string/number/boolean values are dropped (degrade to "field absent"). |
| `honeypotTripped(schema, body)` | `(schema: FormSchema, body: Record<string, unknown>) => boolean` | True when the schema declares a honeypot and the body carries any non-empty value in it. |
| `buildSubmission(schema, body)` | `(schema: FormSchema, body: Record<string, unknown>) => Submission` | Builds the canonical `Submission`, including `readFields` and the `_page`/`_locale` meta keys. |
| `META_PAGE_KEY`, `META_LOCALE_KEY` | `"_page"`, `"_locale"` | Reserved, underscore-prefixed body keys the client helper fills so the server can populate `SubmissionMeta` without guessing from headers. |

#### Errors

`validate()` itself never throws on untrusted input; a malformed `field.pattern` (schema/author-controlled) throws from `new RegExp(...)` as a programming error, not caught here.

## "./sinks"

Pluggable delivery: `FormSink` is the port, one factory per vendor.

| Export | Signature | Notes |
|---|---|---|
| `FormSink` (type) | `{ type: string; deliver(submission, schema): Promise<SinkResult> }` | The delivery port. Implementations report failure via `{ ok: false }` or by throwing; the server handler isolates either per sink. |
| `SinkResult` (type) | `{ ok: boolean; detail?: string }` | |
| `SinkConfig` (type) | `WebhookSinkConfig \| HubspotSinkConfig \| GoogleSheetsSinkConfig \| FileSinkConfig` | |
| `SinkRuntime` (type) | `{ fetchImpl?: typeof fetch; env?: EnvRecord }` | Injection seam shared by every fetch-backed sink; tests pass a fake `fetchImpl`/`env`. |
| `EnvRecord` (type) | `Record<string, string \| undefined>` | |
| `resolveEnvRef(value, env)` | `(value: string, env: EnvRecord) => string` | Resolves a `"${VAR}"` reference against `env`; any other string passes through unchanged. |
| `requireEnvRef(value, env, what)` | `(value: string, env: EnvRecord, what: string) => string` | Like `resolveEnvRef`, but refuses a literal (non-`${VAR}`) value, for fields that only ever hold credentials. |
| `createWebhookSink(config, runtime?)` | `(config: WebhookSinkConfig, runtime?: SinkRuntime) => FormSink` | POSTs the `Submission` as JSON to any URL. |
| `createHubspotSink(config, runtime?)` | `(config: HubspotSinkConfig, runtime?: SinkRuntime) => FormSink` | HubSpot Forms submit API v3. |
| `createGoogleSheetsSink(config, runtime?)` | `(config: GoogleSheetsSinkConfig, runtime?: SinkRuntime) => FormSink` | One row per submission via Sheets API v4 `values.append`. |
| `createFileSink(config)` | `(config: FileSinkConfig) => FormSink` | JSONL append to a local path; the reference/dev sink. `node:fs/promises` is imported inside `deliver`, so loading `"./sinks"` stays possible on edge runtimes with no Node builtins. |
| `resolveSink(sink, runtime?)` | `(sink: SinkConfig \| FormSink, runtime?: SinkRuntime) => FormSink` | Resolves a config into a `FormSink`, or passes an already-built sink straight through. |

**`WebhookSinkConfig`:**

| Option | Type | Default | Notes |
|---|---|---|---|
| `type` | `"webhook"` | required | |
| `url` | `string` | required | |
| `headers` | `Record<string, string>` | none | Values may be `"${VAR}"` environment references (e.g. an `Authorization` secret). |
| `required` | `boolean` | `false` | Shared by all sink configs; when true the handler's overall response fails if this sink fails. |

**`HubspotSinkConfig`:**

| Option | Type | Default | Notes |
|---|---|---|---|
| `type` | `"hubspot"` | required | |
| `portalId` / `formGuid` | `string` | required | |
| `hutkField` | `string` | none | Name of the schema field carrying the visitor's `hubspotutk` cookie; sent as `context.hutk` and excluded from the mapped fields. |
| `accessToken` | `string` | none | A `"${VAR}"` reference to a private-app token; switches to the authenticated `/secure/submit` endpoint. |

**`GoogleSheetsSinkConfig`:**

| Option | Type | Default | Notes |
|---|---|---|---|
| `type` | `"google-sheets"` | required | |
| `spreadsheetId` | `string` | required | |
| `range` | `string` | `"A1"` | A1-notation range to append after. |
| `token` | `string` | required | A `"${VAR}"` reference to an OAuth or service-account bearer token. |

**`FileSinkConfig`:**

| Option | Type | Default | Notes |
|---|---|---|---|
| `type` | `"file"` | required | |
| `path` | `string` | required | JSONL output path; parent directories are created as needed. |

#### Errors

- `resolveSink`: throws `` resolveSink: unknown sink type "<type>" `` for an unrecognized `config.type`.
- `resolveEnvRef`: throws `` environment variable <name> is not set `` when a `"${VAR}"` reference names a variable missing from `env`.
- `requireEnvRef`: throws `` <what> must be a ${VAR} environment reference, not a literal `` when given a plain string instead of a `"${VAR}"` reference.

## "./server"

A single web-standard `Request`/`Response` handler, so the same function mounts on Workers, Lambda function URLs, and Next/Node route handlers alike.

| Export | Signature | Notes |
|---|---|---|
| `createFormHandler(config)` | `(config: FormHandlerConfig) => (request: Request) => Promise<Response>` | Flow: parse body, honeypot check, `validate`, optional `spamVerifier`, then fan out to every sink with per-sink isolation (one sink failing never loses the submission for the others). |
| `SpamVerifier` (type) | `(input: { submission: Submission; body: Record<string, unknown>; request: Request }) => Promise<boolean>` | Return `false` to reject. A verifier that throws is treated as a rejection (fail closed); one that wants to fail open during a vendor outage must catch and return `true` itself. |
| `SinkOutcome` (type) | `{ type: string; ok: boolean; detail?: string }` | |
| `FormResponseBody` (type) | `{ ok: boolean; errors?: ValidationError[]; sinks?: SinkOutcome[] }` | JSON body of every non-204 response. |

**`FormHandlerConfig`:**

| Option | Type | Default | Notes |
|---|---|---|---|
| `schema` | `FormSchema` | required | |
| `sinks` | `Array<SinkConfig \| FormSink>` | required | |
| `spamVerifier` | `SpamVerifier` | none | |
| `cors` | `{ origins: "*" \| string[] }` | none (opt-in) | Omit for same-origin deployments. |
| `fetchImpl` | `typeof fetch` | global `fetch` | |
| `env` | `EnvRecord` | `process.env` | |
| `logger` | `(message: string) => void` | `console.error` | One line per failed sink and per verifier error. Carries the form id and sink outcome only, never submission field values, by construction. |

Response behavior: `OPTIONS` with `cors` set returns `204` with CORS headers; non-`POST` returns `405`; an unparseable body returns `400` with `{ ok: false, errors: [{ field: "", code: "bad_request" }] }`; a tripped honeypot returns a bare `204` (no error, so a bot gets no detection signal); failed validation returns `400` with the validation errors; a rejected spam check returns `403` with `{ field: "", code: "spam" }`. Otherwise sinks run and the response is `200` when every `required` sink succeeded, else `502`, with `{ ok, sinks }` either way.

> **Security:** validation is server-authoritative — the client's own `validate()` call is UX-only and never trusted by the handler. Sink failures are logged with the form id and sink type only; submission field values never reach the logger.

## "./client"

The browser-safe submit helper.

| Export | Signature | Notes |
|---|---|---|
| `submitForm(source, options)` | `(source: HTMLFormElement \| Record<string, unknown>, options: SubmitOptions) => Promise<SubmitResult>` | Serializes a form element (or a plain data record) via `FormData`, fills the reserved `_page`/`_locale` meta keys from `location`/`document` when available and not already set, and POSTs JSON to `options.endpoint`. |
| `SubmitOptions` (type) | `{ endpoint: string; schema?: FormSchema; fetchImpl?: typeof fetch }` | `schema`, when given, validates locally first purely for inline-error UX; the server always re-validates regardless. |
| `SubmitResult` (type) | `{ ok: boolean; status: number; errors?: ValidationError[]; sinks?: SinkOutcome[] }` | `status` is `0` when local validation failed and no request was sent. A `204` response (tripped honeypot) resolves `{ ok: true, status: 204 }`. A non-JSON response body (e.g. a proxy error page) falls back to `{ ok: response.ok, status: response.status }`. |

#### Errors

Neither export throws on the happy or sad path of a submission; a thrown `fetchImpl` rejection propagates to the caller of `submitForm` uncaught.
