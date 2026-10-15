import type { EnvRecord } from "../sinks/env";
import { resolveSink } from "../sinks/index";
import type { FormSink, SinkConfig } from "../sinks/types";
import { buildSubmission, honeypotTripped } from "../submission";
import type { FormSchema, Submission, ValidationError } from "../types";
import { validate } from "../validate";

/**
 * Pluggable spam check the handler awaits after validation, e.g. verifying a
 * CAPTCHA/turnstile token. `body` is the raw parsed body so the verifier can
 * read a token field the schema does not declare; `submission` is the
 * canonical shape it protects. Return false to reject.
 */
export type SpamVerifier = (input: {
  submission: Submission;
  body: Record<string, unknown>;
  request: Request;
}) => Promise<boolean>;

export interface SinkOutcome {
  type: string;
  ok: boolean;
  detail?: string;
}

/** JSON body of every non-204 handler response. */
export interface FormResponseBody {
  ok: boolean;
  errors?: ValidationError[];
  sinks?: SinkOutcome[];
}

export interface FormHandlerConfig {
  schema: FormSchema;
  sinks: Array<SinkConfig | FormSink>;
  spamVerifier?: SpamVerifier;
  /** CORS is opt-in; omit it for same-origin deployments. */
  cors?: { origins: "*" | string[] };
  fetchImpl?: typeof fetch;
  env?: EnvRecord;
  /** Hard cap on the request body, checked against bytes actually read off the
   *  stream rather than trusted from Content-Length (a chunked request carries
   *  none). Default 64 KB; a form with large textareas can raise it. */
  maxBodyBytes?: number;
  /**
   * Receives one line per failed sink and per verifier error. Lines carry the
   * form id and sink outcome only, never submission field values (PII stays
   * out of logs by construction). Defaults to console.error.
   */
  logger?: (message: string) => void;
}

function corsHeaders(request: Request, cors: FormHandlerConfig["cors"]): Record<string, string> {
  if (!cors) return {};
  const origin = request.headers.get("origin");
  if (!origin) return {};
  if (cors.origins === "*") return { "access-control-allow-origin": "*" };
  return cors.origins.includes(origin) ? { "access-control-allow-origin": origin, vary: "origin" } : {};
}

function json(status: number, body: FormResponseBody, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "content-type": "application/json" },
  });
}

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

/** Reads the request body incrementally, counting bytes as they arrive, and
 *  bails out (canceling the stream, never buffering the rest) the moment the
 *  running total exceeds `maxBytes`. Copied from core's github-webhook
 *  capped reader: forms can't import core internals across the package
 *  boundary, and a Content-Length check alone never fires for a chunked
 *  request that carries no such header. */
async function readBodyCapped(request: Request, maxBytes: number): Promise<ArrayBuffer | null> {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

/**
 * Parses a JSON or form-encoded (urlencoded/multipart) request body into a
 * null-prototype record. Returns null for anything unparseable, oversized, or
 * any JSON that is not a plain object. File parts are dropped: submissions
 * carry text, not uploads.
 */
async function parseBody(request: Request, maxBodyBytes: number): Promise<Record<string, unknown> | null> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) return null;

  const buffer = await readBodyCapped(request, maxBodyBytes);
  if (buffer === null) return null;

  const contentType = request.headers.get("content-type") ?? "";
  try {
    // Re-wrap the already-capped bytes in a Request so the existing
    // json()/formData() parsing logic is untouched; the stream itself was
    // only ever read once, here.
    const capped = new Request(request.url, { method: "POST", headers: request.headers, body: buffer });
    if (contentType.includes("application/json")) {
      const parsed: unknown = await capped.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
      return Object.assign(Object.create(null), parsed) as Record<string, unknown>;
    }
    const form = await capped.formData();
    const body: Record<string, unknown> = Object.create(null);
    for (const [key, value] of form) {
      if (typeof value === "string") body[key] = value;
    }
    return body;
  } catch {
    return null;
  }
}

/**
 * One framework-agnostic handler over web-standard Request/Response, so the
 * same function mounts on Workers, Lambda function URLs, and Next/Node route
 * handlers alike. Flow: parse, honeypot, validate, optional spam verifier,
 * then fan out to every sink with per-sink isolation: one sink failing must
 * not lose the submission for the others. The response is ok when every sink
 * marked `required` succeeded; by default no sink is required, so failures
 * are reported but do not fail the response.
 */
export function createFormHandler(config: FormHandlerConfig): (request: Request) => Promise<Response> {
  const runtime = { fetchImpl: config.fetchImpl, env: config.env };
  const sinks = config.sinks.map((entry) => ({
    sink: resolveSink(entry, runtime),
    required: "deliver" in entry ? false : (entry.required ?? false),
  }));
  const logger = config.logger ?? ((message: string) => console.error(message));
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return async (request) => {
    const cors = corsHeaders(request, config.cors);
    if (request.method === "OPTIONS" && config.cors) {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { ...cors, allow: "POST" } });
    }

    const body = await parseBody(request, maxBodyBytes);
    if (body === null) {
      return json(400, { ok: false, errors: [{ field: "", code: "bad_request" }] }, cors);
    }

    // A tripped honeypot is silently accepted and dropped: a 204 with no
    // error gives a bot no signal that it was detected.
    if (honeypotTripped(config.schema, body)) {
      return new Response(null, { status: 204, headers: cors });
    }

    const submission = buildSubmission(config.schema, body);
    const validation = validate(config.schema, submission.fields);
    if (!validation.ok) {
      return json(400, { ok: false, errors: validation.errors }, cors);
    }

    if (config.spamVerifier) {
      // Fail closed: a verifier that throws rejects the submission, the same
      // doctrine as AuthAdapter.authorize. A verifier that wants to fail open
      // during its vendor's outage can catch and return true itself.
      let human = false;
      try {
        human = await config.spamVerifier({ submission, body, request });
      } catch (error) {
        logger(`form ${config.schema.id}: spam verifier threw: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!human) {
        return json(403, { ok: false, errors: [{ field: "", code: "spam" }] }, cors);
      }
    }

    const results = await Promise.allSettled(sinks.map(({ sink }) => sink.deliver(submission, config.schema, request)));
    const outcomes: SinkOutcome[] = results.map((result, index) => {
      const type = sinks[index].sink.type;
      if (result.status === "fulfilled") return { type, ...result.value };
      return { type, ok: false, detail: result.reason instanceof Error ? result.reason.message : String(result.reason) };
    });
    for (const outcome of outcomes) {
      if (!outcome.ok) {
        logger(`form ${config.schema.id}: sink ${outcome.type} failed${outcome.detail ? `: ${outcome.detail}` : ""}`);
      }
    }

    const ok = sinks.every(({ required }, index) => !required || outcomes[index].ok);
    // Sink failure detail (vendor response bodies, stack messages) is server
    // log material, not a public response field: it can leak vendor internals
    // (endpoint shapes, auth hints) to whoever submitted the form.
    const publicSinks: SinkOutcome[] = outcomes.map(({ type, ok: sinkOk }) => ({ type, ok: sinkOk }));
    return json(ok ? 200 : 502, { ok, sinks: publicSinks }, cors);
  };
}
