import type { FormResponseBody, SinkOutcome } from "../server/index";
import { assertBrowserSafeSinkConfig, resolveSink } from "../sinks/index";
import type { SinkConfig } from "../sinks/types";
import { buildSubmission, honeypotTripped, META_LOCALE_KEY, META_PAGE_KEY, readFields } from "../submission";
import type { FormSchema, ValidationError } from "../types";
import { validate } from "../validate";

export interface SubmitOptions {
  endpoint: string;
  /** When given, the submission is validated locally first, purely for UX; the server re-validates regardless. */
  schema?: FormSchema;
  fetchImpl?: typeof fetch;
}

/**
 * Delivers straight from the browser to a vendor, with no handler in
 * between: validate -> honeypot -> deliver, the same semantics as the server
 * handler minus the trust boundary (there is no server left to re-validate).
 * Only sinks `assertBrowserSafeSinkConfig` accepts may be used this way; a
 * server-only sink (a "${VAR}" credential, `google-sheets`, `file`) throws
 * rather than silently bundling a secret into client code.
 */
export interface SinkSubmitOptions {
  sink: SinkConfig;
  schema: FormSchema;
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

async function deliverToSink(
  body: Record<string, unknown>,
  options: SinkSubmitOptions,
): Promise<SubmitResult> {
  // Fail closed and loud: a server-only sink slipped into static-site config
  // must break the build/page immediately, not silently ship a secret.
  assertBrowserSafeSinkConfig(options.sink);

  const validation = validate(options.schema, readFields(options.schema, body));
  if (!validation.ok) return { ok: false, status: 0, errors: validation.errors };

  // Mirrors the handler: a tripped honeypot is accepted silently (no
  // delivery, no error), so a bot gets no signal it was detected.
  if (honeypotTripped(options.schema, body)) return { ok: true, status: 204 };

  const sink = resolveSink(options.sink, { fetchImpl: options.fetchImpl });
  const submission = buildSubmission(options.schema, body);
  const result = await sink.deliver(submission, options.schema);
  return { ok: result.ok, status: result.ok ? 200 : 502, sinks: [{ type: sink.type, ok: result.ok, detail: result.detail }] };
}

/**
 * Progressive-enhancement submit: serializes a form element (or a plain data
 * record), fills the reserved _page/_locale meta keys from the document when
 * available, then either POSTs JSON to a server handler (`endpoint`) or
 * delivers directly to one browser-safe sink (`sink`) for a fully static
 * site with no server runtime. Local validation with a schema is a
 * convenience for inline error UX only; a server handler never trusts it ran
 * (sink mode has no server left to re-validate, so the local run is
 * authoritative there by necessity, not by trust).
 */
export async function submitForm(
  source: HTMLFormElement | Record<string, unknown>,
  options: SubmitOptions | SinkSubmitOptions,
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

  if ("sink" in options) return deliverToSink(body, options);

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
