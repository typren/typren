import { describe, expect, it } from "vitest";
import type { FormSchema, Submission } from "../types";
import { createGoogleSheetsSink } from "./google-sheets";

function fakeFetch(status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status });
  }) as typeof fetch;
  return { impl, calls };
}

const schema: FormSchema = {
  id: "contact",
  fields: [
    { name: "name", type: "text" },
    { name: "email", type: "email" },
    { name: "consent", type: "checkbox" },
  ],
};

const submission: Submission = {
  formId: "contact",
  fields: { email: "ada@example.com", name: "Ada", consent: true },
  meta: { submittedAt: "2026-09-22T00:00:00.000Z" },
};

describe("createGoogleSheetsSink", () => {
  it("appends one row in schema field order with a leading timestamp", async () => {
    const { impl, calls } = fakeFetch();
    const sink = createGoogleSheetsSink(
      { type: "google-sheets", spreadsheetId: "sheet-id", token: "${SHEETS_TOKEN}" },
      { fetchImpl: impl, env: { SHEETS_TOKEN: "ya29.token" } },
    );
    const result = await sink.deliver(submission, schema);

    expect(result).toEqual({ ok: true });
    expect(calls[0].url).toBe(
      "https://sheets.googleapis.com/v4/spreadsheets/sheet-id/values/A1:append?valueInputOption=RAW",
    );
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({ authorization: "Bearer ya29.token" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      values: [["2026-09-22T00:00:00.000Z", "Ada", "ada@example.com", true]],
    });
  });

  it("writes an empty cell for a schema field the submission omitted", async () => {
    const { impl, calls } = fakeFetch();
    const sink = createGoogleSheetsSink(
      { type: "google-sheets", spreadsheetId: "sheet-id", token: "${SHEETS_TOKEN}" },
      { fetchImpl: impl, env: { SHEETS_TOKEN: "t" } },
    );
    await sink.deliver({ ...submission, fields: { name: "Ada" } }, schema);
    expect(JSON.parse(String(calls[0].init.body)).values[0]).toEqual(["2026-09-22T00:00:00.000Z", "Ada", "", ""]);
  });

  it("URL-encodes the configured range", async () => {
    const { impl, calls } = fakeFetch();
    const sink = createGoogleSheetsSink(
      { type: "google-sheets", spreadsheetId: "sheet-id", range: "Leads!A1", token: "${SHEETS_TOKEN}" },
      { fetchImpl: impl, env: { SHEETS_TOKEN: "t" } },
    );
    await sink.deliver(submission, schema);
    expect(calls[0].url).toContain("/values/Leads!A1:append");
  });

  it("refuses a literal token and fails when the referenced variable is unset", async () => {
    const literal = createGoogleSheetsSink(
      { type: "google-sheets", spreadsheetId: "sheet-id", token: "ya29.literal" },
      { fetchImpl: fakeFetch().impl, env: {} },
    );
    await expect(literal.deliver(submission, schema)).rejects.toThrow("environment reference");

    const unset = createGoogleSheetsSink(
      { type: "google-sheets", spreadsheetId: "sheet-id", token: "${SHEETS_TOKEN}" },
      { fetchImpl: fakeFetch().impl, env: {} },
    );
    await expect(unset.deliver(submission, schema)).rejects.toThrow("SHEETS_TOKEN");
  });

  it("reports a non-2xx response as a failed delivery", async () => {
    const sink = createGoogleSheetsSink(
      { type: "google-sheets", spreadsheetId: "sheet-id", token: "${SHEETS_TOKEN}" },
      { fetchImpl: fakeFetch(403).impl, env: { SHEETS_TOKEN: "t" } },
    );
    expect(await sink.deliver(submission, schema)).toEqual({ ok: false, detail: "sheets responded 403" });
  });
});
