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

  it("resolve() leaves source.token as a ${VAR} reference for the provider's own gate", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        app: "demo",
        source: { type: "export-api", baseUrl: "https://tms.example/${TMS_REGION}", projectId: "p1", token: "${TMS_TOKEN}" },
      }),
    );
    const result = readConfigFile(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    process.env.TMS_REGION = "eu";
    process.env.TMS_TOKEN = "sk-secret";
    try {
      const resolved = result.resolve();
      expect((resolved.source as { baseUrl?: string }).baseUrl).toBe("https://tms.example/eu");
      expect((resolved.source as { token?: string }).token).toBe("${TMS_TOKEN}");
    } finally {
      delete process.env.TMS_REGION;
      delete process.env.TMS_TOKEN;
    }
  });

  it("resolve() uses app and publicKeys raw, and never interpolates the signing key", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        app: "${TYPREN_SIGNING_KEY}",
        source: { type: "files", dir: "${LEAK_DIR}" },
        publicKeys: [{ kid: "${TYPREN_SIGNING_KEY}" }],
      }),
    );
    const result = readConfigFile(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envVarNames).toEqual(["LEAK_DIR"]);

    process.env.TYPREN_SIGNING_KEY = "s3cret";
    process.env.LEAK_DIR = "/srv";
    try {
      const resolved = result.resolve();
      expect(resolved.app).toBe("${TYPREN_SIGNING_KEY}");
      expect(resolved.publicKeys).toEqual([{ kid: "${TYPREN_SIGNING_KEY}" }]);
      writeFileSync(file, JSON.stringify({ app: "demo", source: { type: "files", dir: "${TYPREN_SIGNING_KEY}" } }));
      const inSource = readConfigFile(file);
      if (!inSource.ok) throw new Error("unreachable");
      expect(() => inSource.resolve()).toThrow(/missing required env var "TYPREN_SIGNING_KEY"/);
      expect(JSON.stringify(resolved)).not.toContain("s3cret");
    } finally {
      delete process.env.TYPREN_SIGNING_KEY;
      delete process.env.LEAK_DIR;
    }
  });
});
