import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfigFile } from "./config-file";

describe("readConfigFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "typren-locale-cli-config-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("errors when the file doesn't exist", () => {
    const result = readConfigFile(join(dir, "missing.json"));
    expect(result).toEqual({ ok: false, error: expect.stringContaining("not found") });
  });

  it("errors on malformed JSON", () => {
    const file = join(dir, "config.json");
    writeFileSync(file, "{ not json");
    const result = readConfigFile(file);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("not valid JSON");
  });

  it("errors when the shape isn't { app, source }", () => {
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ app: "demo" }));
    const result = readConfigFile(file);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("must be a { app: string, source: object }");
  });

  it("reads a valid config and collects its ${VAR} names without resolving them", () => {
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ app: "demo", source: { type: "files", dir: "${LOCALE_SOURCE_DIR}" } }));
    const result = readConfigFile(file);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envVarNames).toEqual(["LOCALE_SOURCE_DIR"]);
    expect(() => result.resolve()).toThrow(/missing required env var "LOCALE_SOURCE_DIR"/);
  });

  it("resolve() interpolates once the env var is set", () => {
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ app: "demo", source: { type: "files", dir: "${LOCALE_SOURCE_DIR}" } }));
    const result = readConfigFile(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    process.env.LOCALE_SOURCE_DIR = "/srv/locales";
    try {
      expect(result.resolve()).toEqual({ app: "demo", source: { type: "files", dir: "/srv/locales" } });
    } finally {
      delete process.env.LOCALE_SOURCE_DIR;
    }
  });
});
