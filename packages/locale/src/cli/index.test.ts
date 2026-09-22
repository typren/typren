import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./index";

function withTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "typren-locale-cli-index-"));
}

describe("main (verb router)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it("--version prints the package.json version and exits clean", async () => {
    await main(["--version"]);
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf8")) as { version: string };
    expect(logSpy.mock.calls.flat()).toContain(pkg.version);
    expect(process.exitCode).toBeUndefined();
  });

  it("no args prints the global help", async () => {
    await main([]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("typren-locale: build-time CLI");
  });

  it("a known verb's --help prints that verb's help, not the global one", async () => {
    await main(["pull", "--help"]);
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("usage: typren-locale pull");
    expect(out).not.toContain("typren-locale: build-time CLI");
  });

  it("an unknown verb errors with exit code 1", async () => {
    await main(["frobnicate"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain('unknown verb "frobnicate"');
  });

  it("pull without --config fails with exit code 1, not a throw", async () => {
    await main(["pull"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain("--config <path> is required");
  });

  it("bake without --out fails with exit code 1", async () => {
    await main(["bake", "--config", "whatever.json"]);
    expect(process.exitCode).toBe(1);
  });

  it("diff without two directories fails with exit code 1", async () => {
    await main(["diff", "onlyOneDir"]);
    expect(process.exitCode).toBe(1);
  });

  it("compat rejects a subcommand that isn't 'lokalise2 file download'", async () => {
    await main(["compat", "lokalise2", "file", "upload"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain("lokalise2 file download");
  });

  it("wires pull's flags through end to end (--config/--out/--filename-style)", async () => {
    const sourceDir = withTmpDir();
    const configDir = withTmpDir();
    const outDir = join(withTmpDir(), "out");
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Greeting: "Hi" }));
    const configPath = join(configDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ app: "demo", source: { type: "files", dir: sourceDir } }));

    try {
      await main(["pull", "--config", configPath, "--out", outDir, "--filename-style", "underscore"]);
      expect(process.exitCode).toBeUndefined();
      expect(readdirSync(outDir)).toEqual(["en.json"]);
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(configDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("rejects an invalid --filename-style before touching the filesystem", async () => {
    await main(["pull", "--config", "whatever.json", "--filename-style", "yell"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain('--filename-style must be "dash" or "underscore"');
  });
});
