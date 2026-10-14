# @typren/forms

Form handling for Typren sites, and for any site that wants it standalone: a
canonical submission model, server-authoritative validation, honeypot plus
pluggable spam verification, and delivery to pluggable **sinks** (webhook,
HubSpot, Google Sheets, a JSONL file). Zero runtime dependencies.

## Install

```bash
npm install @typren/forms
```

## Quick start

```ts
// app/api/contact/route.ts
import { createFormHandler } from "@typren/forms/server";
import type { FormSchema } from "@typren/forms";

const contactForm: FormSchema = {
  id: "contact",
  honeypot: "company",
  fields: [
    { name: "name", type: "text", required: true },
    { name: "email", type: "email", required: true },
    { name: "message", type: "textarea", required: true },
    { name: "company", type: "hidden" },
  ],
};

export const POST = createFormHandler({
  schema: contactForm,
  sinks: [{ type: "webhook", url: "https://example.com/hooks/contact" }],
});
```

```ts
// client component
import { submitForm } from "@typren/forms/client";

await submitForm(formElement, { endpoint: "/api/contact", schema: contactForm });
```

See [docs/site/forms.md](https://github.com/typren/typren/blob/main/docs/site/forms.md)
for the full guide and [docs/site/reference-forms.md](https://github.com/typren/typren/blob/main/docs/site/reference-forms.md)
for every export and sink config shape.
