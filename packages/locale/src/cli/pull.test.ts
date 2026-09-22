import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { printPullResult, runPull } from "./pull";

function withTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "typren-locale-cli-pull-"));
}

describe("runPull", () => {
  let sourceDir: string;
  let configDir: string;
  let outDir: string;
  let configPath: string;

  beforeEach(() => {
    sourceDir = withTmpDir();
    configDir = withTmpDir();
    outDir = join(withTmpDir(), "out");
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Greeting: "Hi" }));
    writeFileSync(join(sourceDir, "fr.json"), JSON.stringify({ Greeting: "Salut" }));
    configPath = join(configDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ app: "demo", source: { type: "files", dir: sourceDir } }));
  });

  afterEach(() => {
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  it("writes one dash-style <locale>.json per locale by default", async () => {
    const result = await runPull({ configPath, outDir });
    expect(result).toEqual({ ok: true, app: "demo", outDir, paths: { en: join(outDir, "en.json"), fr: join(outDir, "fr.json") } });
    expect(readdirSync(outDir).sort()).toEqual(["en.json", "fr.json"]);
    expect(JSON.parse(readFileSync(join(outDir, "en.json"), "utf8"))).toEqual({ Greeting: "Hi" });
  });

  it("honors --filename-style underscore", async () => {
    // Source locale key itself doesn't contain "-" here, so exercise the
    // style through a locale that does.
    writeFileSync(join(sourceDir, "en_US.json"), JSON.stringify({ Greeting: "Hi" }));
    const result = await runPull({ configPath, outDir, filenameStyle: "underscore" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.values(result.paths)).toContain(join(outDir, "en_US.json"));
  });

  it("defaults outDir to ./locales when --out is omitted", async () => {
    const cwdBefore = process.cwd();
    const cwdDir = withTmpDir();
    process.chdir(cwdDir);
    try {
      const result = await runPull({ configPath });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.outDir).toBe("./locales");
      expect(readdirSync(join(cwdDir, "locales")).sort()).toEqual(["en.json", "fr.json"]);
    } finally {
      process.chdir(cwdBefore);
      rmSync(cwdDir, { recursive: true, force: true });
    }
  });

  it("fails cleanly when the config file is missing", async () => {
    const result = await runPull({ configPath: join(sourceDir, "missing.json"), outDir });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("not found") });
  });

  it("fails cleanly when a referenced env var is unresolved", async () => {
    writeFileSync(configPath, JSON.stringify({ app: "demo", source: { type: "files", dir: "${MISSING_VAR}" } }));
    const result = await runPull({ configPath, outDir });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('missing required env var "MISSING_VAR"');
  });

  it("printPullResult sets exit code 1 on failure and 0 on success", () => {
    process.exitCode = undefined;
    printPullResult({ ok: false, error: "boom" });
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    printPullResult({ ok: true, app: "demo", outDir, paths: { en: join(outDir, "en.json") } });
    expect(process.exitCode).toBeUndefined();
  });
});
