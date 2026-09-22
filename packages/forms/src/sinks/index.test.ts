import { describe, expect, it } from "vitest";
import { resolveSink } from "./index";
import type { FormSink, SinkConfig } from "./types";

describe("resolveSink", () => {
  it.each([
    [{ type: "webhook", url: "https://x.example" }, "webhook"],
    [{ type: "hubspot", portalId: "1", formGuid: "g" }, "hubspot"],
    [{ type: "google-sheets", spreadsheetId: "s", token: "${T}" }, "google-sheets"],
    [{ type: "file", path: "/tmp/x.jsonl" }, "file"],
  ] as Array<[SinkConfig, string]>)("resolves %o to a %s sink", (config, type) => {
    const sink = resolveSink(config);
    expect(sink.type).toBe(type);
    expect(typeof sink.deliver).toBe("function");
  });

  it("passes an already-built sink straight through", () => {
    const custom: FormSink = { type: "custom", deliver: async () => ({ ok: true }) };
    expect(resolveSink(custom)).toBe(custom);
  });

  it("throws on an unknown config type", () => {
    expect(() => resolveSink({ type: "carrier-pigeon" } as unknown as SinkConfig)).toThrow(
      'unknown sink type "carrier-pigeon"',
    );
  });
});
