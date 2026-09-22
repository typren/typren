# Forms (`@typren/forms`) — architecture

Form handling for static Typren sites. Today a consumer who wants a contact
form hand-wires a vendor into their pages; this package owns the canonical
submission model instead and treats every storage or delivery vendor as a
pluggable **sink** — the same ports-and-adapters doctrine the rest of the
repository uses. The core has zero runtime dependencies.

## The model

A `FormSchema` declares a form's fields (`text`, `email`, `textarea`,
`select`, `checkbox`, `hidden`, with `required`/`maxLength`/`pattern`/
`options` constraints) plus an optional honeypot field name. `validate()` is
**server-authoritative**: the client helper can run the same function for
inline error UX, but the server never trusts that it ran.

Every sink receives the same canonical `Submission`:

```ts
{ formId, fields: Record<string, string | boolean>, meta: { submittedAt, page?, locale? } }
```

Fields are extracted from the untrusted body by iterating the **schema's**
field names, never the body's keys, into a null-prototype record —
`__proto__`/`constructor`/`prototype` are refused outright, so a crafted
payload degrades to "field absent" rather than reaching `Object.prototype`.

## Sinks

The port is one interface; `resolveSink()` maps a discriminated-union config
to an implementation (the switch is the whole registry), and passes an
already-built sink straight through for custom vendors.

```ts
interface FormSink {
  type: string;
  deliver(submission: Submission, schema: FormSchema): Promise<{ ok: boolean; detail?: string }>;
}
```

| Sink | Delivers to | Notes |
|---|---|---|
| `webhook` | any URL, POSTed as JSON | the universal escape hatch; header values may be `${VAR}` env references |
| `hubspot` | HubSpot Forms submit API v3 | fields mapped to `{name,value}` pairs, optional `hutk` cookie via a hidden field, `${VAR}` token switches to the authenticated endpoint |
| `google-sheets` | Sheets API v4 `values.append`, raw REST | one row per submission: leading timestamp, then schema field order |
| `file` | JSONL append to a local path | the reference/dev sink that proves the port |

Credentials never live in config literals: token fields must be `${VAR}`
environment references, resolved at deliver time (a literal is refused so a
pasted secret fails fast instead of reaching version control).

## The handler

`createFormHandler(config)` returns one framework-agnostic
`(Request) => Promise<Response>` over web-standard types, so the same
function mounts on Cloudflare Workers, Lambda function URLs, and Next/Node
route handlers alike. Flow: parse (JSON or form-encoded) → honeypot →
validate → optional async spam verifier (e.g. a CAPTCHA/turnstile token
check) → fan out to **all** configured sinks via `Promise.allSettled`, so one
sink failing never loses the submission for the others. The response is `ok`
when every sink marked `required` succeeded; by default no sink is required
and failures are reported per sink but do not fail the response. CORS is
opt-in config.

`@typren/forms/client` ships `submitForm()`, a progressive-enhancement helper
that serializes a form element, keeps the honeypot field untouched, and POSTs
JSON to the handler. No framework wrappers yet.

## Spam and PII stance

- **Honeypot**: a hidden field that must arrive empty. A tripped honeypot is
  answered with a bare `204` — silently accepted and dropped, delivering to
  no sink, so a bot gets no signal it was detected.
- **Spam verifier**: a pluggable async hook the handler awaits; it fails
  closed (a throwing verifier rejects the submission), the same doctrine as
  `AuthAdapter.authorize()`.
- **PII**: submission field values are never logged. Log lines carry the form
  id and per-sink outcomes only, by construction of the logger call sites.
