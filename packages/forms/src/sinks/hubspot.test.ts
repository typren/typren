import { describe, expect, it } from "vitest";
import type { Submission } from "../types";
import { createHubspotSink } from "./hubspot";

function fakeFetch(status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status });
  }) as typeof fetch;
  return { impl, calls };
}

const schema = { id: "contact", fields: [] };

function makeSubmission(fields: Submission["fields"], page?: string): Submission {
  return { formId: "contact", fields, meta: { submittedAt: "2026-09-22T00:00:00.000Z", ...(page ? { page } : {}) } };
}

describe("createHubspotSink", () => {
  it("maps fields to HubSpot's {name,value} array on the anonymous endpoint", async () => {
    const { impl, calls } = fakeFetch();
    const sink = createHubspotSink({ type: "hubspot", portalId: "424242", formGuid: "guid-1" }, { fetchImpl: impl });
    const result = await sink.deliver(makeSubmission({ email: "ada@example.com", consent: true }), schema);

    expect(result).toEqual({ ok: true });
    expect(calls[0].url).toBe("https://api.hsforms.com/submissions/v3/integration/submit/424242/guid-1");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.fields).toEqual([
      { name: "email", value: "ada@example.com" },
      { name: "consent", value: "true" },
    ]);
    expect(body.context).toBeUndefined();
    expect(calls[0].init.headers).not.toHaveProperty("authorization");
  });

  it("reads hutk from the request's hubspotutk cookie and excludes the legacy field from fields", async () => {
    const { impl, calls } = fakeFetch();
    const sink = createHubspotSink(
      { type: "hubspot", portalId: "424242", formGuid: "guid-1", hutkField: "hutk" },
      { fetchImpl: impl },
    );
    const request = new Request("https://site.example/api", { headers: { cookie: "hubspotutk=cookie-value; other=1" } });
    await sink.deliver(makeSubmission({ email: "ada@example.com", hutk: "body-value" }, "/pricing"), schema, request);

    const body = JSON.parse(String(calls[0].init.body));
    expect(body.fields).toEqual([{ name: "email", value: "ada@example.com" }]);
    expect(body.context).toEqual({ hutk: "cookie-value", pageUri: "/pricing" });
  });

  it("ignores a hutk value submitted in the body when there is no cookie header at all", async () => {
    const { impl, calls } = fakeFetch();
    const sink = createHubspotSink(
      { type: "hubspot", portalId: "424242", formGuid: "guid-1", hutkField: "hutk" },
      { fetchImpl: impl },
    );
    const request = new Request("https://site.example/api");
    await sink.deliver(makeSubmission({ email: "ada@example.com", hutk: "forged-value" }, "/pricing"), schema, request);
    expect(JSON.parse(String(calls[0].init.body)).context).toEqual({ pageUri: "/pricing" });
  });

  it("ignores a hutk value submitted in the body when the hubspotutk cookie is absent from a non-empty header", async () => {
    const { impl, calls } = fakeFetch();
    const sink = createHubspotSink(
      { type: "hubspot", portalId: "424242", formGuid: "guid-1", hutkField: "hutk" },
      { fetchImpl: impl },
    );
    const request = new Request("https://site.example/api", { headers: { cookie: "session=abc; other=1" } });
    await sink.deliver(makeSubmission({ email: "ada@example.com", hutk: "forged-value" }, "/pricing"), schema, request);
    expect(JSON.parse(String(calls[0].init.body)).context).toEqual({ pageUri: "/pricing" });
  });

  it("omits hutk entirely when hutkField is not configured, even with a cookie present", async () => {
    const { impl, calls } = fakeFetch();
    const sink = createHubspotSink({ type: "hubspot", portalId: "424242", formGuid: "guid-1" }, { fetchImpl: impl });
    const request = new Request("https://site.example/api", { headers: { cookie: "hubspotutk=cookie-value" } });
    await sink.deliver(makeSubmission({ email: "ada@example.com" }, "/pricing"), schema, request);
    expect(JSON.parse(String(calls[0].init.body)).context).toEqual({ pageUri: "/pricing" });
  });

  it("uses the secure endpoint with a bearer token resolved from the env reference", async () => {
    const { impl, calls } = fakeFetch();
    const sink = createHubspotSink(
      { type: "hubspot", portalId: "424242", formGuid: "guid-1", accessToken: "${HUBSPOT_TOKEN}" },
      { fetchImpl: impl, env: { HUBSPOT_TOKEN: "pat-123" } },
    );
    await sink.deliver(makeSubmission({ email: "ada@example.com" }), schema);

    expect(calls[0].url).toBe("https://api.hsforms.com/submissions/v3/integration/secure/submit/424242/guid-1");
    expect(calls[0].init.headers).toMatchObject({ authorization: "Bearer pat-123" });
  });

  it("refuses a literal access token: credentials travel by env reference only", async () => {
    const sink = createHubspotSink(
      { type: "hubspot", portalId: "424242", formGuid: "guid-1", accessToken: "pat-literal" },
      { fetchImpl: fakeFetch().impl, env: {} },
    );
    await expect(sink.deliver(makeSubmission({}), schema)).rejects.toThrow("environment reference");
  });

  it("reports a non-2xx response as a failed delivery", async () => {
    const sink = createHubspotSink({ type: "hubspot", portalId: "424242", formGuid: "guid-1" }, { fetchImpl: fakeFetch(400).impl });
    expect(await sink.deliver(makeSubmission({}), schema)).toEqual({ ok: false, detail: "hubspot responded 400" });
  });
});
