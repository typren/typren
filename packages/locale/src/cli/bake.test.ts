import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("picks up the default alias file and serves copies", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Greeting: "Hi" }));
    writeFileSync(join(sourceDir, "_aliases.json"), JSON.stringify({ Hello: { to: "Greeting", since: "2026-01-01" } }));
    const result = await runBake({ configPath, outDir, buildVersion: "v1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.aliasCount).toBe(1);
    const file = join(outDir, "catalog", "demo", "en", `${result.hashes.en}.json`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ Greeting: "Hi", Hello: "Hi" });
  });

  it("errors when an explicit alias path is missing", async () => {
    const missing = join(sourceDir, "nope.json");
    expect(await runBake({ configPath, outDir, aliasesPath: missing })).toEqual({ ok: false, error: `alias file not found: ${missing}` });
  });

  it("errors on invalid aliases and on an unreadable alias file", async () => {
    writeFileSync(join(sourceDir, "_aliases.json"), JSON.stringify({ Hello: { to: "Missing", since: "2026-01-01" } }));
    const bad = await runBake({ configPath, outDir });
    expect(bad.ok).toBe(false);
    writeFileSync(join(sourceDir, "_aliases.json"), "{");
    const broken = await runBake({ configPath, outDir });
    expect(broken.ok).toBe(false);
  });

  it("runs the gated publish and reports app/locales/hashes/delta count", async () => {
    const result = await runBake({ configPath, outDir, buildVersion: "v1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.app).toBe("demo");
    expect(result.locales).toEqual(["en"]);
    expect(result.hashes.en).toMatch(/^[0-9a-f]{64}$/);
    expect(result.deltaCount).toBe(0);
    expect(result.aliasCount).toBe(0);
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
    printBakeResult({ ok: true, app: "demo", locales: ["en"], hashes: { en: "abc" }, deltaCount: 0, aliasCount: 0 });
    expect(process.exitCode).toBeUndefined();
  });
});
