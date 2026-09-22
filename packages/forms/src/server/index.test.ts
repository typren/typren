import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { FormSink } from "../sinks/types";
import type { FormSchema, Submission } from "../types";
import { createFormHandler, type FormResponseBody } from "./index";

const schema: FormSchema = {
  id: "contact",
  fields: [
    { name: "name", type: "text", required: true },
    { name: "email", type: "email", required: true },
    { name: "consent", type: "checkbox" },
  ],
  honeypot: "website",
};

function tmpFile(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "typren-forms-")), "submissions.jsonl");
}

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://site.example/api/forms/contact", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function memorySink(type = "memory"): FormSink & { delivered: Submission[] } {
  const delivered: Submission[] = [];
  return {
    type,
    delivered,
    async deliver(submission) {
      delivered.push(submission);
      return { ok: true };
    },
  };
}

const valid = { name: "Ada", email: "ada@example.com" };

describe("createFormHandler", () => {
  it("accepts a JSON submission end to end through the file sink", async () => {
    const file = tmpFile();
    const handler = createFormHandler({ schema, sinks: [{ type: "file", path: file }] });
    const response = await handler(jsonRequest({ ...valid, consent: "on", _page: "/contact" }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as FormResponseBody;
    expect(body.ok).toBe(true);
    expect(body.sinks).toEqual([{ type: "file", ok: true }]);

    const stored = JSON.parse(readFileSync(file, "utf8").trim()) as Submission;
    expect(stored.formId).toBe("contact");
    expect(stored.fields).toEqual({ name: "Ada", email: "ada@example.com", consent: true });
    expect(stored.meta.page).toBe("/contact");
  });

  it("accepts a form-encoded submission", async () => {
    const sink = memorySink();
    const handler = createFormHandler({ schema, sinks: [sink] });
    const response = await handler(
      new Request("https://site.example/api", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ name: "Ada", email: "ada@example.com", consent: "on", website: "" }).toString(),
      }),
    );
    expect(response.status).toBe(200);
    expect(sink.delivered[0].fields).toEqual({ name: "Ada", email: "ada@example.com", consent: true });
  });

  it("silently accepts and drops a tripped honeypot with a bare 204", async () => {
    const sink = memorySink();
    const handler = createFormHandler({ schema, sinks: [sink] });
    const response = await handler(jsonRequest({ ...valid, website: "https://spam.example" }));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(sink.delivered).toHaveLength(0);
  });

  it("rejects an invalid submission with the validation errors and delivers nothing", async () => {
    const sink = memorySink();
    const handler = createFormHandler({ schema, sinks: [sink] });
    const response = await handler(jsonRequest({ name: "", email: "nope" }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as FormResponseBody;
    expect(body.ok).toBe(false);
    expect(body.errors).toContainEqual({ field: "name", code: "required" });
    expect(body.errors).toContainEqual({ field: "email", code: "invalid_email" });
    expect(sink.delivered).toHaveLength(0);
  });

  it.each([
    ["unparseable JSON", () => new Request("https://x.example", { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" })],
    ["a JSON array body", () => jsonRequest([1, 2])],
    ["a JSON scalar body", () => jsonRequest("hello")],
  ])("rejects %s as bad_request", async (_label, make) => {
    const handler = createFormHandler({ schema, sinks: [] });
    const response = await handler(make());
    expect(response.status).toBe(400);
    expect(((await response.json()) as FormResponseBody).errors).toEqual([{ field: "", code: "bad_request" }]);
  });

  it("rejects non-POST methods with 405", async () => {
    const handler = createFormHandler({ schema, sinks: [] });
    const response = await handler(new Request("https://x.example", { method: "GET" }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("awaits the spam verifier with the raw body and rejects when it says bot", async () => {
    const sink = memorySink();
    const verifier = vi.fn(async ({ body }: { body: Record<string, unknown> }) => body.turnstile === "valid-token");
    const handler = createFormHandler({ schema, sinks: [sink], spamVerifier: verifier });

    const rejected = await handler(jsonRequest({ ...valid, turnstile: "forged" }));
    expect(rejected.status).toBe(403);
    expect(((await rejected.json()) as FormResponseBody).errors).toEqual([{ field: "", code: "spam" }]);
    expect(sink.delivered).toHaveLength(0);

    const accepted = await handler(jsonRequest({ ...valid, turnstile: "valid-token" }));
    expect(accepted.status).toBe(200);
    expect(sink.delivered).toHaveLength(1);
  });

  it("fails closed when the spam verifier throws, logging without field values", async () => {
    const logs: string[] = [];
    const handler = createFormHandler({
      schema,
      sinks: [],
      spamVerifier: async () => {
        throw new Error("captcha backend down");
      },
      logger: (message) => logs.push(message),
    });
    const response = await handler(jsonRequest(valid));
    expect(response.status).toBe(403);
    expect(logs).toEqual(["form contact: spam verifier threw: captcha backend down"]);
    expect(logs[0]).not.toContain("Ada");
  });

  it("isolates sink failures: one throwing sink loses nothing for the others", async () => {
    const file = tmpFile();
    const broken: FormSink = {
      type: "broken",
      deliver: async () => {
        throw new Error("vendor exploded");
      },
    };
    const logs: string[] = [];
    const handler = createFormHandler({
      schema,
      sinks: [broken, { type: "file", path: file }],
      logger: (message) => logs.push(message),
    });
    const response = await handler(jsonRequest(valid));

    expect(response.status).toBe(200);
    const body = (await response.json()) as FormResponseBody;
    expect(body.ok).toBe(true);
    expect(body.sinks).toEqual([
      { type: "broken", ok: false, detail: "vendor exploded" },
      { type: "file", ok: true },
    ]);
    expect(readFileSync(file, "utf8")).toContain('"formId":"contact"');
    expect(logs).toEqual(["form contact: sink broken failed: vendor exploded"]);
    expect(logs[0]).not.toContain("Ada");
  });

  it("fails the response when a required sink fails, still delivering to the rest", async () => {
    const sink = memorySink();
    const handler = createFormHandler({
      schema,
      sinks: [{ type: "webhook", url: "https://hooks.example/f", required: true }, sink],
      fetchImpl: (async () => new Response(null, { status: 500 })) as typeof fetch,
      logger: () => {},
    });
    const response = await handler(jsonRequest(valid));

    expect(response.status).toBe(502);
    const body = (await response.json()) as FormResponseBody;
    expect(body.ok).toBe(false);
    expect(body.sinks).toEqual([
      { type: "webhook", ok: false, detail: "webhook responded 500" },
      { type: "memory", ok: true },
    ]);
    expect(sink.delivered).toHaveLength(1);
  });

  it("leaves a prototype-pollution payload inert end to end", async () => {
    const sink = memorySink();
    const handler = createFormHandler({ schema, sinks: [sink] });
    const response = await handler(
      new Request("https://x.example", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"name":"Ada","email":"ada@example.com","__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}',
      }),
    );
    expect(response.status).toBe(200);
    expect(sink.delivered[0].fields).toEqual({ name: "Ada", email: "ada@example.com" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("answers a preflight and echoes an allowed origin, CORS being opt-in", async () => {
    const handler = createFormHandler({ schema, sinks: [], cors: { origins: ["https://site.example"] } });

    const preflight = await handler(
      new Request("https://x.example", { method: "OPTIONS", headers: { origin: "https://site.example" } }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://site.example");
    expect(preflight.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");

    const post = await handler(jsonRequest(valid, { origin: "https://site.example" }));
    expect(post.headers.get("access-control-allow-origin")).toBe("https://site.example");

    const denied = await handler(jsonRequest(valid, { origin: "https://evil.example" }));
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();

    const noCors = createFormHandler({ schema, sinks: [] });
    const plain = await noCors(jsonRequest(valid, { origin: "https://site.example" }));
    expect(plain.headers.get("access-control-allow-origin")).toBeNull();
    const options = await noCors(new Request("https://x.example", { method: "OPTIONS" }));
    expect(options.status).toBe(405);
  });

  it("supports the wildcard origin", async () => {
    const handler = createFormHandler({ schema, sinks: [], cors: { origins: "*" } });
    const response = await handler(jsonRequest(valid, { origin: "https://anywhere.example" }));
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("delivers nothing anywhere for a honeypot hit even with sinks configured", async () => {
    const file = tmpFile();
    const handler = createFormHandler({ schema, sinks: [{ type: "file", path: file }] });
    await handler(jsonRequest({ ...valid, website: "bot" }));
    expect(existsSync(file)).toBe(false);
  });
});
