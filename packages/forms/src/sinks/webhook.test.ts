import { describe, expect, it } from "vitest";
import type { Submission } from "../types";
import { createWebhookSink } from "./webhook";

function fakeFetch(status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status });
  }) as typeof fetch;
  return { impl, calls };
}

const submission: Submission = {
  formId: "contact",
  fields: { name: "Ada", consent: true },
  meta: { submittedAt: "2026-09-22T00:00:00.000Z" },
};
const schema = { id: "contact", fields: [] };

describe("createWebhookSink", () => {
  it("POSTs the submission as JSON to the configured URL", async () => {
    const { impl, calls } = fakeFetch();
    const sink = createWebhookSink({ type: "webhook", url: "https://hooks.example/f" }, { fetchImpl: impl });
    const result = await sink.deliver(submission, schema);

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://hooks.example/f");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual(submission);
  });

  it("resolves ${VAR} header references from the injected env, literals pass through", async () => {
    const { impl, calls } = fakeFetch();
    const sink = createWebhookSink(
      { type: "webhook", url: "https://hooks.example/f", headers: { authorization: "${HOOK_SECRET}", "x-source": "typren" } },
      { fetchImpl: impl, env: { HOOK_SECRET: "Bearer sekrit" } },
    );
    await sink.deliver(submission, schema);
    expect(calls[0].init.headers).toMatchObject({ authorization: "Bearer sekrit", "x-source": "typren" });
  });

  it("fails the delivery when a referenced variable is missing", async () => {
    const sink = createWebhookSink(
      { type: "webhook", url: "https://hooks.example/f", headers: { authorization: "${HOOK_SECRET}" } },
      { fetchImpl: fakeFetch().impl, env: {} },
    );
    await expect(sink.deliver(submission, schema)).rejects.toThrow("HOOK_SECRET");
  });

  it("reports a non-2xx response as a failed delivery with the status in detail", async () => {
    const sink = createWebhookSink({ type: "webhook", url: "https://hooks.example/f" }, { fetchImpl: fakeFetch(500).impl });
    expect(await sink.deliver(submission, schema)).toEqual({ ok: false, detail: "webhook responded 500" });
  });
});
