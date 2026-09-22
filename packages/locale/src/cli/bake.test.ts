import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { printBakeResult, runBake } from "./bake";

function withTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "typren-locale-cli-bake-"));
}

describe("runBake", () => {
  let sourceDir: string;
  let configDir: string;
  let outDir: string;
  let configPath: string;

  beforeEach(() => {
    sourceDir = withTmpDir();
    configDir = withTmpDir();
    outDir = withTmpDir();
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Greeting: "Hi" }));
    configPath = join(configDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ app: "demo", source: { type: "files", dir: sourceDir } }));
  });

  afterEach(() => {
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  it("runs the gated publish and reports app/locales/hashes/delta count", async () => {
    const result = await runBake({ configPath, outDir, buildVersion: "v1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.app).toBe("demo");
    expect(result.locales).toEqual(["en"]);
    expect(result.hashes.en).toMatch(/^[0-9a-f]{64}$/);
    expect(result.deltaCount).toBe(0);
    expect(existsSync(join(outDir, "manifest", "demo.json"))).toBe(true);
  });

  it("defaults buildVersion to an ISO timestamp when not given", async () => {
    const result = await runBake({ configPath, outDir });
    expect(result.ok).toBe(true);
  });

  it("surfaces a gate failure (dangerous HTML) as a clean error, not a throw", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Greeting: "<script>alert(1)</script>" }));
    const result = await runBake({ configPath, outDir });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("assertNoHtml");
  });

  it("fails cleanly on a missing config file", async () => {
    const result = await runBake({ configPath: join(sourceDir, "missing.json"), outDir });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("not found") });
  });

  it("printBakeResult sets exit code 1 on failure and leaves it unset on success", () => {
    process.exitCode = undefined;
    printBakeResult({ ok: false, error: "boom" });
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    printBakeResult({ ok: true, app: "demo", locales: ["en"], hashes: { en: "abc" }, deltaCount: 0 });
    expect(process.exitCode).toBeUndefined();
  });
});
