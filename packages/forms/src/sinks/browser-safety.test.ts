import { describe, expect, it } from "vitest";
import { assertBrowserSafeSinkConfig } from "./browser-safety";
import type { SinkConfig } from "./types";

describe("assertBrowserSafeSinkConfig", () => {
  it("accepts a webhook sink with no env references", () => {
    expect(() => assertBrowserSafeSinkConfig({ type: "webhook", url: "https://example.com/hook" })).not.toThrow();
  });

  it("accepts a hubspot sink with no accessToken", () => {
    expect(() =>
      assertBrowserSafeSinkConfig({ type: "hubspot", portalId: "123", formGuid: "abc" }),
    ).not.toThrow();
  });

  it("refuses a hubspot sink with an accessToken reference", () => {
    expect(() =>
      assertBrowserSafeSinkConfig({ type: "hubspot", portalId: "123", formGuid: "abc", accessToken: "${HUBSPOT_TOKEN}" }),
    ).toThrow(/server-only/);
  });

  it("refuses a webhook sink whose headers carry a \"${...}\" reference", () => {
    const config: SinkConfig = { type: "webhook", url: "https://example.com/hook", headers: { authorization: "${TOKEN}" } };
    expect(() => assertBrowserSafeSinkConfig(config)).toThrow(/server-only/);
  });

  it("refuses a webhook sink whose config carries a \"${...}\"-shaped literal even if unresolvable as an env ref", () => {
    const config: SinkConfig = { type: "webhook", url: "https://example.com/${not-a-var}" };
    expect(() => assertBrowserSafeSinkConfig(config)).toThrow(/server-only/);
  });

  it("refuses google-sheets outright, regardless of config", () => {
    expect(() =>
      assertBrowserSafeSinkConfig({ type: "google-sheets", spreadsheetId: "1AbC", token: "${SHEETS_TOKEN}" }),
    ).toThrow(/server-only/);
  });

  it("refuses file outright, regardless of config", () => {
    expect(() => assertBrowserSafeSinkConfig({ type: "file", path: "/tmp/out.jsonl" })).toThrow(/server-only/);
  });
  it("refuses a literal secret: hubspot accessToken or any webhook header, whatever the value", () => {
    expect(() =>
      assertBrowserSafeSinkConfig({ type: "hubspot", portalId: "1", formGuid: "g", accessToken: "pat-na1-literal" })
    ).toThrow(/accessToken/);
    expect(() =>
      assertBrowserSafeSinkConfig({ type: "webhook", url: "https://h.example/x", headers: { Authorization: "Bearer sk_live_1" } })
    ).toThrow(/headers/);
  });
});
