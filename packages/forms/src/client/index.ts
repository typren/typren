import type { FormResponseBody, SinkOutcome } from "../server/index";
import { META_LOCALE_KEY, META_PAGE_KEY, readFields } from "../submission";
import type { FormSchema, ValidationError } from "../types";
import { validate } from "../validate";

export interface SubmitOptions {
  endpoint: string;
  /** When given, the submission is validated locally first, purely for UX; the server re-validates regardless. */
  schema?: FormSchema;
  fetchImpl?: typeof fetch;
}

export interface SubmitResult {
  ok: boolean;
  /** HTTP status, or 0 when local validation failed and no request was sent. */
  status: number;
  errors?: ValidationError[];
  sinks?: SinkOutcome[];
}

function serializeForm(form: HTMLFormElement): Record<string, unknown> {
  const body: Record<string, unknown> = Object.create(null);
  // FormData carries the honeypot input untouched (empty for humans), and
  // spells a checked checkbox "on"; readFields/the server coerce that.
  for (const [key, value] of new FormData(form)) {
    if (typeof value === "string") body[key] = value;
  }
  return body;
}

/**
 * Progressive-enhancement submit: serializes a form element (or a plain data
 * record), fills the reserved _page/_locale meta keys from the document when
 * available, and POSTs JSON to the handler. Local validation with a schema is
 * a convenience for inline error UX only; the server never trusts it ran.
 */
export async function submitForm(
  source: HTMLFormElement | Record<string, unknown>,
  options: SubmitOptions,
): Promise<SubmitResult> {
  const isFormElement = typeof HTMLFormElement !== "undefined" && source instanceof HTMLFormElement;
  const body = isFormElement
    ? serializeForm(source)
    : (Object.assign(Object.create(null), source) as Record<string, unknown>);

  if (typeof location !== "undefined" && body[META_PAGE_KEY] === undefined) {
    body[META_PAGE_KEY] = location.pathname;
  }
  if (typeof document !== "undefined" && body[META_LOCALE_KEY] === undefined && document.documentElement.lang) {
    body[META_LOCALE_KEY] = document.documentElement.lang;
  }

  if (options.schema) {
    const local = validate(options.schema, readFields(options.schema, body));
    if (!local.ok) return { ok: false, status: 0, errors: local.errors };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(options.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 204) return { ok: true, status: 204 };

  let parsed: FormResponseBody | undefined;
  try {
    parsed = (await response.json()) as FormResponseBody;
  } catch {
    // A non-JSON body (proxy error page) falls back to the HTTP status alone.
  }
  return {
    ok: parsed?.ok ?? response.ok,
    status: response.status,
    ...(parsed?.errors ? { errors: parsed.errors } : {}),
    ...(parsed?.sinks ? { sinks: parsed.sinks } : {}),
  };
}
