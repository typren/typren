import { describe, expect, it } from "vitest";
import { readManifest, studioConfig } from "./config";

const manifest = { siteDir: "/site", contentDir: "/site/content", siteUrl: "http://127.0.0.1:3000", defaults: { hero: { heading: "" } } };

describe("readManifest", () => {
  it("parses the env JSON", () => {
    expect(readManifest(JSON.stringify(manifest))).toEqual(manifest);
  });

  it("explains how to start the studio when the env var is missing", () => {
    expect(() => readManifest("")).toThrow(/typren studio/);
  });
});

describe("studioConfig", () => {
  it("gates with localAuth, which denies outside a loopback-bound dev server", async () => {
    expect(await studioConfig(manifest).auth!.authorize({ action: "read" })).toBe(false);
  });
});
