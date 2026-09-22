import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveProvider } from "./resolve-provider";
import type { SourceConfig } from "./provider";

describe("resolveProvider", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "typren-locale-resolve-"));
    writeFileSync(join(dir, "en.json"), JSON.stringify({ A: "a" }));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves a bare dir string to the fs provider", async () => {
    const provider = resolveProvider(dir);
    expect(provider.type).toBe("files");
    expect(await provider.loadSource()).toEqual({ en: { A: "a" } });
  });

  it("resolves a { type: 'files' } config to the fs provider", async () => {
    const provider = resolveProvider({ type: "files", dir });
    expect(await provider.loadSource()).toEqual({ en: { A: "a" } });
  });

  it("passes an already-built provider straight through", () => {
    const passthrough = { type: "custom", loadSource: async () => ({}) };
    expect(resolveProvider(passthrough)).toBe(passthrough);
  });

  it("throws a clear error for a source type with no registered provider (the sibling slot)", () => {
    const unimplemented = { type: "lokalise" } as unknown as SourceConfig;
    expect(() => resolveProvider(unimplemented)).toThrow(/unknown source type "lokalise"/);
  });
});
