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

/**
 * Parses a JSON or form-encoded (urlencoded/multipart) request body into a
 * null-prototype record. Returns null for anything unparseable or any JSON
 * that is not a plain object. File parts are dropped: submissions carry
 * text, not uploads.
 */
async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const parsed: unknown = await request.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
      return Object.assign(Object.create(null), parsed) as Record<string, unknown>;
    }
    const form = await request.formData();
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

    const body = await parseBody(request);
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

    const results = await Promise.allSettled(sinks.map(({ sink }) => sink.deliver(submission, config.schema)));
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
    return json(ok ? 200 : 502, { ok, sinks: outcomes }, cors);
  };
}
