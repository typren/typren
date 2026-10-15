import { describe, expect, it } from "vitest";
import type { FormSchema } from "../types";
import { submitForm } from "./index";

const schema: FormSchema = {
  id: "contact",
  fields: [
    { name: "name", type: "text", required: true },
    { name: "email", type: "email", required: true },
    { name: "consent", type: "checkbox" },
  ],
  honeypot: "website",
};

function fakeFetch(status = 200, body: unknown = { ok: true, sinks: [{ type: "file", ok: true }] }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, calls };
}

function makeForm(): HTMLFormElement {
  const form = document.createElement("form");
  form.innerHTML = `
    <input name="name" value="Ada">
    <input name="email" value="ada@example.com">
    <input type="checkbox" name="consent" checked>
    <input type="text" name="website" value="" style="display:none" tabindex="-1" autocomplete="off">
  `;
  document.body.append(form);
  return form;
}

describe("submitForm", () => {
  it("serializes a form element, honeypot included untouched, and POSTs JSON", async () => {
    const { impl, calls } = fakeFetch();
    const result = await submitForm(makeForm(), { endpoint: "/api/forms/contact", fetchImpl: impl });

    expect(result).toEqual({ ok: true, status: 200, sinks: [{ type: "file", ok: true }] });
    expect(calls[0].url).toBe("/api/forms/contact");
    expect(calls[0].init.method).toBe("POST");
    const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({ name: "Ada", email: "ada@example.com", consent: "on", website: "" });
    expect(sent._page).toBe(location.pathname);
  });

  it("accepts a plain data record and fills _page/_locale only when absent", async () => {
    document.documentElement.lang = "de";
    const { impl, calls } = fakeFetch();
    await submitForm({ name: "Ada", email: "ada@example.com", _page: "/custom" }, { endpoint: "/api", fetchImpl: impl });
    const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(sent._page).toBe("/custom");
    expect(sent._locale).toBe("de");
    document.documentElement.lang = "";
  });

  it("validates locally with a schema and sends nothing on failure", async () => {
    const { impl, calls } = fakeFetch();
    const result = await submitForm({ name: "", email: "nope" }, { endpoint: "/api", schema, fetchImpl: impl });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.errors).toContainEqual({ field: "name", code: "required" });
    expect(result.errors).toContainEqual({ field: "email", code: "invalid_email" });
    expect(calls).toHaveLength(0);
  });

  it("still submits when local validation passes with a schema", async () => {
    const { impl, calls } = fakeFetch();
    const result = await submitForm({ name: "Ada", email: "ada@example.com" }, { endpoint: "/api", schema, fetchImpl: impl });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("maps the server's validation errors into the result", async () => {
    const { impl } = fakeFetch(400, { ok: false, errors: [{ field: "email", code: "invalid_email" }] });
    const result = await submitForm({ name: "Ada", email: "x" }, { endpoint: "/api", fetchImpl: impl });
    expect(result).toEqual({ ok: false, status: 400, errors: [{ field: "email", code: "invalid_email" }] });
  });

  it("treats the handler's silent 204 as accepted", async () => {
    const { impl } = fakeFetch(204);
    expect(await submitForm({ name: "Ada" }, { endpoint: "/api", fetchImpl: impl })).toEqual({ ok: true, status: 204 });
  });

  it("falls back to the HTTP status when the body is not JSON", async () => {
    const impl = (async () => new Response("<html>gateway error</html>", { status: 502 })) as typeof fetch;
    expect(await submitForm({ name: "Ada" }, { endpoint: "/api", fetchImpl: impl })).toEqual({ ok: false, status: 502 });
  });
});

describe("submitForm with a sink (static-site mode, no server)", () => {
  it("throws for a server-only sink instead of delivering it", async () => {
    await expect(
      submitForm(
        { name: "Ada", email: "ada@example.com" },
        { sink: { type: "google-sheets", spreadsheetId: "1AbC", token: "${SHEETS_TOKEN}" }, schema },
      ),
    ).rejects.toThrow(/server-only/);
  });

  it("throws for a webhook sink whose headers carry a \"${...}\" reference", async () => {
    await expect(
      submitForm(
        { name: "Ada", email: "ada@example.com" },
        { sink: { type: "webhook", url: "https://example.com/hook", headers: { authorization: "${TOKEN}" } }, schema },
      ),
    ).rejects.toThrow(/server-only/);
  });

  it("validates locally and sends nothing on failure", async () => {
    const { impl, calls } = fakeFetch();
    const result = await submitForm(
      { name: "", email: "nope" },
      { sink: { type: "webhook", url: "https://example.com/hook" }, schema, fetchImpl: impl },
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.errors).toContainEqual({ field: "name", code: "required" });
    expect(calls).toHaveLength(0);
  });

  it("drops a tripped honeypot silently, delivering nothing", async () => {
    const { impl, calls } = fakeFetch();
    const result = await submitForm(
      { name: "Ada", email: "ada@example.com", website: "spam" },
      { sink: { type: "webhook", url: "https://example.com/hook" }, schema, fetchImpl: impl },
    );
    expect(result).toEqual({ ok: true, status: 204 });
    expect(calls).toHaveLength(0);
  });

  it("delivers to the sink directly when valid and not a bot", async () => {
    const { impl, calls } = fakeFetch(200, { received: true });
    const result = await submitForm(
      { name: "Ada", email: "ada@example.com" },
      { sink: { type: "webhook", url: "https://example.com/hook" }, schema, fetchImpl: impl },
    );
    expect(result).toEqual({ ok: true, status: 200, sinks: [{ type: "webhook", ok: true, detail: undefined }] });
    expect(calls[0].url).toBe("https://example.com/hook");
    const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({ formId: "contact", fields: { name: "Ada", email: "ada@example.com" } });
  });

  it("reports a failed delivery without throwing", async () => {
    const { impl } = fakeFetch(502);
    const result = await submitForm(
      { name: "Ada", email: "ada@example.com" },
      { sink: { type: "webhook", url: "https://example.com/hook" }, schema, fetchImpl: impl },
    );
    expect(result).toEqual({ ok: false, status: 502, sinks: [{ type: "webhook", ok: false, detail: "webhook responded 502" }] });
  });
});
