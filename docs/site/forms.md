---
title: Forms
description: Schema, server-authoritative validation, pluggable sinks, and the web-standard handler in @typren/forms.
category: Guides
order: 22
---

`@typren/forms` handles form submission for a Typren site: a canonical
submission model, server-authoritative validation, honeypot plus pluggable
spam verification, and delivery to one or more **sinks** (webhook, HubSpot,
Google Sheets, a JSONL file). It has no runtime dependencies and no
dependency on `@typren/core` — install it on its own.

```sh
npm install @typren/forms
```

Four subpaths, split by runtime:

| Subpath | Contents |
|---|---|
| `@typren/forms` | `FormSchema`, `validate`, `readFields`, `buildSubmission` — runs anywhere |
| `@typren/forms/sinks` | `resolveSink`, sink configs and factories, `${VAR}` env resolution |
| `@typren/forms/server` | `createFormHandler` — the web-standard request handler |
| `@typren/forms/client` | `submitForm` — the browser submit helper |

## Declaring a form

```ts
import type { FormSchema } from "@typren/forms";

const contactForm: FormSchema = {
  id: "contact",
  honeypot: "company",
  fields: [
    { name: "name", type: "text", required: true, maxLength: 120 },
    { name: "email", type: "email", required: true },
    { name: "message", type: "textarea", required: true, maxLength: 4000 },
    { name: "company", type: "hidden" }, // the honeypot field itself
  ],
};
```

`validate(schema, fields)` is server-authoritative: the client helper can run
it too, purely for inline UX, but the server never trusts that it ran.
Fields are extracted from the untrusted request body by iterating the
**schema's** field names — never the body's own keys — into a
null-prototype record, so `__proto__`/`constructor`/`prototype` are refused
outright and a crafted payload degrades to "field absent."

The handler caps the request body at 64 KB by default (configurable), read
as a bounded stream rather than buffered in full before the cap is checked.
Every field also gets a default `maxLength` of 10,000 characters, applied
before any `pattern` is tested against the value, regardless of whether the
schema sets its own `maxLength` — a field with no explicit limit isn't a
field with no limit.

Every sink receives the same canonical shape:

```ts
interface Submission {
  formId: string;
  fields: Record<string, string | boolean>;
  meta: { submittedAt: string; page?: string; locale?: string };
}
```

## Wiring sinks

`createFormHandler` returns the handler function directly — mount it as
your route's `POST` export:

```ts
// app/api/contact/route.ts
import { createFormHandler } from "@typren/forms/server";

export const POST = createFormHandler({
  schema: contactForm,
  sinks: [
    { type: "webhook", url: "https://example.com/hooks/contact", headers: { authorization: "${CONTACT_WEBHOOK_TOKEN}" } },
    { type: "google-sheets", spreadsheetId: "1AbC...", range: "Sheet1!A1", token: "${SHEETS_TOKEN}" },
  ],
});
```

Credential fields (`accessToken`, `token`, a `webhook` header value) must be
a literal `"${VAR}"` reference resolved against `process.env` (or a custom
`env` record) at deliver time, never a literal secret — a pasted token
fails fast instead of landing in version control. See the sink table in
[reference-forms](./reference-forms.md) for every sink's config shape.

A HubSpot sink's `hutk` must come from the `hubspotutk` cookie, read
server-side off the incoming request — never from a value the client puts in
the form body, since that would let any submitter claim an arbitrary
tracking identity.

The `webhook` sink follows redirects manually (`redirect: "manual"`) and
treats any `3xx` response as a delivery failure rather than following it:
a webhook endpoint that silently redirects elsewhere is not the endpoint the
site owner configured. The `file` sink caps the size of each appended line,
so one oversized submission can't balloon the JSONL file or stall a reader
that assumes bounded lines.

A custom vendor implements `FormSink` directly and is passed in place of a
config entry:

```ts
import type { FormSink } from "@typren/forms/sinks";

const mySink: FormSink = { type: "my-crm", deliver: async () => ({ ok: true }) };
```

## The handler flow

`createFormHandler` returns one framework-agnostic `(Request) => Promise<Response>`,
so the same function mounts on Workers, Lambda function URLs, or a Next
route handler. Flow: parse (JSON or form-encoded) → honeypot check → validate
→ optional async `spamVerifier` (e.g. a CAPTCHA/Turnstile token check) → fan
out to every configured sink via `Promise.allSettled`, so one sink failing
never loses the submission for the others.

> **Security:** a tripped honeypot gets a bare `204` with no error body — a
> bot is given no signal it was detected. A throwing `spamVerifier` rejects
> the submission (fails closed), the same doctrine as `AuthAdapter.authorize`.
> Submission field values are never logged; log lines carry only the form id
> and per-sink outcome. The response the caller sees reports only
> `{ type, ok }` per sink — never the sink's error detail (an HTTP status, a
> provider error message, a stack trace), since that detail can leak
> endpoint internals to whoever submitted the form; the full detail is only
> ever logged server-side.

## The client helper

```ts
import { submitForm } from "@typren/forms/client";

const result = await submitForm(formElement, { endpoint: "/api/contact", schema: contactForm });
if (!result.ok) showErrors(result.errors);
```

`submitForm` serializes a form element (or a plain data record), fills the
reserved `_page`/`_locale` meta keys from `location`/`document` when
available, and POSTs JSON to the handler. There are no framework wrappers
(React, Vue) yet — `submitForm` is the whole client surface.
